import { ActorSubclass } from '@dfinity/agent';
import { v4 as uuidV4 } from 'uuid';
import { clearKeys, loadKey, storeKey } from './keyStorage';

import {
  _SERVICE,
  Result_1,
  Result,
} from '../../../declarations/encrypted_notes_backend/encrypted_notes_backend.did';

export class CryptoService {
  static readonly INIT_VECTOR_LENGTH = 12;
  private actor: ActorSubclass<_SERVICE>;
  private intervalId: number | null = null;
  private publicKey: CryptoKey | null;
  private privateKey: CryptoKey | null;
  private symmetricKey: CryptoKey | null;
  private exportedPublicKeyBase64: string | null;
  public readonly deviceAlias: string;

  /**
   * コンストラクター
   */
  constructor(actor: ActorSubclass<_SERVICE>) {
    this.actor = actor;

    this.deviceAlias = window.localStorage.getItem('deviceAlias');
    if (!this.deviceAlias) {
      this.deviceAlias = uuidV4();
      window.localStorage.setItem('deviceAlias', this.deviceAlias);
    }
  }

  /**
   * 初期化関数
   * @returns 
   */
  public async init(): Promise<boolean> {
    // データベースから公開鍵・秘密鍵を取得します。
    this.publicKey = await loadKey('publicKey');
    this.privateKey = await loadKey('privateKey');

    if (!this.publicKey || !this.privateKey) {
      // 公開鍵・秘密鍵が存在しない場合は、生成します。
      const keyPair: CryptoKeyPair = await this.generateKeyPair();

      // 生成した鍵をデータベースに保存します。
      await storeKey('publicKey', keyPair.publicKey);
      await storeKey('privateKey', keyPair.privateKey);

      this.publicKey = keyPair.publicKey;
      this.privateKey = keyPair.privateKey;
    }

    /** STEP8: デバイスデータを登録します。 */
    // publicKeyをexportしてBase64に変換します。
    const exportedPublicKey = await window.crypto.subtle.exportKey(
      'spki',
      this.publicKey,
    );
    this.exportedPublicKeyBase64 = this.arrayBufferToBase64(exportedPublicKey);

    // バックエンドキャニスターにデバイスエイリアスと公開鍵を登録します。
    await this.actor.registerDevice(
      this.deviceAlias,
      this.exportedPublicKeyBase64,
    );

    // 対称鍵が生成されているかどうかを確認します。
    const isSymKeyRegistered = await this.actor.isEncryptedSymmetricKeyRegistered();
    if (!isSymKeyRegistered) {
      console.log('Generate symmetric key...');
      // 対称鍵を生成します。
      this.symmetricKey = await this.generateSymmetricKey();
      // 対称鍵を公開鍵で暗号化します。
      const wrappedSymmetricKeyBase64: string = await this.wrapSymmetricKey(
        this.symmetricKey,
        this.publicKey,
      );
      // 暗号化した対称鍵をバックエンドキャニスターに登録します。
      const result: Result_1 = await this.actor.registerEncryptedSymmetricKey(
                                  this.exportedPublicKeyBase64,
                                  wrappedSymmetricKeyBase64,
                                );

      if ('Err' in result) {
        if ('UnknownPublicKey' in result.Err) {
          throw new Error('Unknown public key');
        }
        if ('AlreadyRegistered' in result.Err) {
          throw new Error('Already registered');
        }
        if ('DeviceNotRegistered' in result.Err) {
          throw new Error('Device not registered');
        }
      }

      /** STEP10: 対称鍵を同期します。 */
      console.log('Synchronizing symmetric keys...');
      if (this.intervalId === null) {
        this.intervalId = window.setInterval(
          () => this.syncSymmetricKey(),
          5000,
        );
      }

      return true;
    } else {
      /** STEP11: 対称鍵を取得します。 */
      console.log('Get symmetric key...');
      const synced = await this.trySyncSymmetricKey();

      return synced;
    }
  }

  public async clearDeviceData(): Promise<void> {
    if (this.intervalId !== null) {
      // インターバルを停止します。
      window.clearInterval(this.intervalId);
      // インターバルIDを初期化します。
      this.intervalId = null;
    }

    // idbに保存された公開鍵と秘密鍵を削除します。
    await clearKeys();
    // ブラウザのローカルストレージに保存されたデバイスエイリアスを削除します。
    window.localStorage.removeItem('deviceAlias');

    // CryptoServiceクラスのメンバー変数を初期化します。
    this.publicKey = null;
    this.privateKey = null;
    this.symmetricKey = null;
    this.exportedPublicKeyBase64 = null;
  }

  /**
   * 復号するための関数
   * @param data 
   * @returns 
   */
  public async decryptNote(data: string): Promise<string> {
    if (this.symmetricKey === null) {
      throw new Error('Not found symmetric key');
    }

    // テキストデータとIVを分離します。
    const base64IvLength: number = (CryptoService.INIT_VECTOR_LENGTH / 3) * 4;
    const decodedIv = data.slice(0, base64IvLength);
    const decodedEncryptedNote = data.slice(base64IvLength);

    // 一文字ずつ`charCodeAt()`で文字コードに変換します。
    const encodedIv = this.base64ToArrayBuffer(decodedIv);
    const encodedEncryptedNote = this.base64ToArrayBuffer(decodedEncryptedNote);

    const decryptedNote: ArrayBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encodedIv,
      },
      this.symmetricKey,
      encodedEncryptedNote,
    );

    const decodedDecryptedNote: string = new TextDecoder().decode(
      decryptedNote,
    );

    return decodedDecryptedNote;
  }

  /**
   * 暗号化する関数
   * @param data 
   * @returns 
   */
  public async encryptNote(data: string): Promise<string> {
    if (this.symmetricKey === null) {
      throw new Error('Not found symmetric key');
    }

    // 12バイトのIV（初期化ベクター）を生成します。
    const iv = window.crypto.getRandomValues(
      new Uint8Array(CryptoService.INIT_VECTOR_LENGTH),
    );

    // ノートをUTF-8のバイト配列に変換します。
    const encodedNote: Uint8Array = new TextEncoder().encode(data);
    // 対称鍵を使ってノートを暗号化します。
    const encryptedNote: ArrayBuffer = await window.crypto.subtle.encrypt(
      // 使用するアルゴリズム
      {
        name: 'AES-GCM',
        iv,
      },
      // 使用する鍵
      this.symmetricKey,
      // 暗号化するデータ
      encodedNote,
    );

    // テキストデータとIVを結合します。
    const decodedIv: string = this.arrayBufferToBase64(iv);
    const decodedEncryptedNote: string = this.arrayBufferToBase64(encryptedNote);

    return decodedIv + decodedEncryptedNote;
  }

  public async trySyncSymmetricKey(): Promise<boolean> {
    /** 対称鍵が同期されているか確認します。 */
    const syncedSymmetricKey: Result = await this.actor.getEncryptedSymmetricKey(this.exportedPublicKeyBase64);

    if ('Err' in syncedSymmetricKey) {
      // エラー処理を行います。
      if ('UnknownPublicKey' in syncedSymmetricKey.Err) {
        throw new Error('Unknown public key');
      }
      if ('DeviceNotRegistered' in syncedSymmetricKey.Err) {
        throw new Error('Device not registered');
      }
      if ('KeyNotSynchronized') {
        console.log('Symmetric key is not synchronized');
        return false;
      }
    } else {
      // 暗号化された対称鍵を取得して復号します。
      this.symmetricKey = await this.unwrapSymmetricKey(
        syncedSymmetricKey.Ok,
        this.privateKey,
      );
      return true;
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    // 1. new Uint8Array(buffer)で`buffer`の中身を一要素1バイトの配列に変換します。
    // 2. String.fromCharCode()で文字列に変換します。
    // // 文字コード（Uint8Arrayには文字が数値として格納されている）を文字（string型）として扱うためです。
    const stringData = String.fromCharCode(...new Uint8Array(buffer));
    // Base64エンコードを行います。
    return window.btoa(stringData);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    // Base64エンコーディングでエンコードされたデータの文字列をデコードします。
    const stringData = window.atob(base64);
    // 1. 一文字ずつ`charCodeAt()`で文字コードに変換します。
    // 2. `Uint8Array.from()`で配列に変換します。
    return Uint8Array.from(stringData, (dataChar) => dataChar.charCodeAt(0));
  }

  private async generateKeyPair(): Promise<CryptoKeyPair> {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        // キー長
        modulusLength: 4096,
        // 公開指数（65537 == 0x010001）
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        // ハッシュアルゴリズム
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
    return keyPair;
  }

  private async generateSymmetricKey(): Promise<CryptoKey> {
    const symmetricKey = await window.crypto.subtle.generateKey(
      {
        // キー生成のアルゴリズム
        name: 'AES-GCM',
        // キー長
        length: 256,
      },
      // キーを抽出可能（バイト配列としてエクスポートできること）とする
      true,
      // キーがサポートする使用法
      ['encrypt', 'decrypt'],
    );
    return symmetricKey;
  }

  private async syncSymmetricKey(): Promise<void> {
    console.log('Syncing symmetric keys...');
    if (this.symmetricKey === null) {
      throw new Error('Symmetric key is not generated');
    }

    // 暗号化された対称鍵を持たない公開鍵一覧を取得します。
    const unsyncedPublicKeys: string[] = await this.actor.getUnsyncedPublicKeys();
    const symmetricKey = this.symmetricKey;
    const encryptedKeys: Array<[string, string]> = [];

    // 自身が保有する対称鍵を公開鍵で暗号化します。
    for (const unsyncedPublicKey of unsyncedPublicKeys) {
      const publicKey: CryptoKey = await window.crypto.subtle.importKey(
        'spki',
        this.base64ToArrayBuffer(unsyncedPublicKey),
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256',
        },
        true,
        ['wrapKey'],
      );
      const wrappedSymmetricKeyBase64: string = await this.wrapSymmetricKey(
        symmetricKey,
        publicKey,
      );
      // 公開鍵と暗号化された対称鍵をペアにして保存します。
      encryptedKeys.push([unsyncedPublicKey, wrappedSymmetricKeyBase64]);
    }
    // 公開鍵と暗号化された対称鍵のペアをアップロードします。
    const result = await this.actor.uploadEncryptedSymmetricKeys(encryptedKeys);

    if ('Err' in result) {
      if ('UnknownPublicKey' in result.Err) {
        throw new Error('Unknown public key');
      }
      if ('DeviceNotRegistered' in result.Err) {
        throw new Error('Device not registered');
      }
    }
  }

  private async unwrapSymmetricKey(
    wrappedSymmetricKeyBase64: string,
    unwrappingKey: CryptoKey,
  ): Promise<CryptoKey> {
    const wrappedSymmetricKey: ArrayBuffer = this.base64ToArrayBuffer(
      wrappedSymmetricKeyBase64,
    );

    const symmetricKey = await window.crypto.subtle.unwrapKey(
      'raw',
      wrappedSymmetricKey,
      unwrappingKey,
      {
        name: 'RSA-OAEP',
      },
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt'],
    );

    return symmetricKey;
  }

  private async wrapSymmetricKey(
    symmetricKey: CryptoKey,
    wrappingKey: CryptoKey,
  ): Promise<string> {
    const wrappedSymmetricKey = await window.crypto.subtle.wrapKey(
      'raw',
      symmetricKey,
      wrappingKey,
      {
        name: 'RSA-OAEP',
      },
    );

    const wrappedSymmetricKeyBase64: string =
      this.arrayBufferToBase64(wrappedSymmetricKey);

    return wrappedSymmetricKeyBase64;
  }
}