import { DBSchema, openDB } from 'idb'

// データベースの型を定義します。
interface KeyStorage extends DBSchema {
  'keys': {
    key: string;
    value: CryptoKey;
  };
}

// データベースを開きます
const db = openDB<KeyStorage>('crypto-store', 1, {
  upgrade(db) {
    db.createObjectStore('keys');
  },
});

// 'keys'ストアに値を保存します
export async function storeKey(key: string, value: CryptoKey) {
  return (await db).put('keys', value, key)
}

// 値を'keys'ストアから取得します
export async function loadKey(key: string) {
  return (await db).get('keys', key)
}

// 'keys'ストアから値を削除します
export async function clearKeys() {
  return (await db).clear('keys')
}