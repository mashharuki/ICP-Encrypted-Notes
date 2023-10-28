import { useCallback } from 'react';

import { useAuthContext } from './authContext';

export const useDeviceCheck = () => {
  const { auth } = useAuthContext();

  const isDeviceRemoved = useCallback(async () => {
    if (auth.status !== 'SYNCED') {
      return false;
    }

    // デバイスエイリアス一覧を取得して、自身のエイリアスが含まれているかを確認します。
    const deviceAlias = await auth.actor.getDeviceAliases();
    // 自身のデバイスエイリアスが含まれていない場合は、デバイスが削除されたと判断します。
    return !deviceAlias.includes(auth.cryptoService.deviceAlias);
  }, [auth]);

  return { isDeviceRemoved };
};
