import { HttpAgent } from '@dfinity/agent';
import { AuthClient } from '@dfinity/auth-client';
import { createContext, useContext, useEffect, useState } from 'react';

import {
  canisterId,
  createActor,
} from '../../../declarations/encrypted_notes_backend';
import { CryptoService } from '../lib/cryptoService';
import { Auth } from '../types';
import { useMessage } from './useMessage';

type AuthState = {
  auth: Auth;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const initialize: AuthState = {
  auth: { status: 'SYNCHRONIZING' },
  login: undefined,
  logout: undefined,
};

export const AuthContext = createContext(initialize);

export const useAuthContext = (): AuthState => useContext(AuthContext);

export const useAuthProvider = (): AuthState => {
  const { showMessage } = useMessage();
  const [auth, setAuth] = useState<Auth>(initialize.auth);

  const setupService = async (authClient: AuthClient) => {
    // ユーザーデータを取得する
    const identity = authClient.getIdentity();

    // 取得した`identity`を使用して、ICと対話する`agent`を作成します。
    const newAgent = new HttpAgent({ identity });
    if (process.env.DFX_NETWORK === 'local') {
      newAgent.fetchRootKey();
    }
    // 認証したユーザーの情報で`actor`を作成します。
    const options = { agent: newAgent };
    const actor = createActor(canisterId, options);

    /** STEP5: CryptoServiceクラスのインスタンスを生成します。 */
    const cryptoService = new CryptoService(actor);

    /** STEP7: デバイスデータの設定を行います。 */
    const initialized = await cryptoService.init();
    console.log(`initialized: ${initialized}`);


    setAuth({ actor, authClient, cryptoService, status: 'SYNCED' });
  };

  /**
   * ログインメソッド
   */
  const login = async (): Promise<void> => {
    const iiUrl = `http://${process.env.INTERNET_IDENTITY_CANISTER_ID}.localhost:4943`;

    return new Promise((resolve, reject) => {
      // AuthClientオブジェクトを作成します。
      AuthClient.create()
        .then((authClient) => {
          // 認証画面を開きます。
          authClient.login({
            identityProvider: iiUrl,
            onSuccess: async () => {
              try {
                await setupService(authClient);
                resolve();
              } catch (err) {
                reject(err);
              }
            },
            onError: (err) => {
              reject(err);
            },
          });
        })
        .catch(reject);
    });
  };

  const logout = async (): Promise<void> => {
    if (auth.status !== 'SYNCED') {
      return;
    }

    try {
      // デバイスデータを削除します。
      await auth.cryptoService.clearDeviceData();
      // AuthClient内のデータをクリアします。
      await auth.authClient.logout();
      setAuth({ status: 'ANONYMOUS' });
    } catch (err) {
      return Promise.reject(err);
    }
  };

  const checkAuthenticated = async () => {
    const authClient = await AuthClient.create();

    // Internet Identityによる認証が完了しているか確認します。
    const isAuthenticated = await authClient.isAuthenticated();
    if (!isAuthenticated) {
      setAuth({ status: 'ANONYMOUS' });
      return;
    }

    await setupService(authClient);
  };

  useEffect(() => {
    try {
      checkAuthenticated();
    } catch (err) {
      showMessage({
        title: 'Failed to check authentication',
        status: 'error',
      });
    }
  }, []);

  return { auth, login, logout };
};
