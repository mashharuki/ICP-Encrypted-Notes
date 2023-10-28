use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::Entry;
use std::collections::HashMap;

/// devicesモジュール内のエラーを表す列挙型です。
#[derive(CandidType, Deserialize, Eq, PartialEq)]
pub enum DeviceError {
    AlreadyRegistered,
    DeviceNotRegistered,
    KeyNotSynchronized,
    UnknownPublicKey,
}

/// 型のエイリアス
pub type DeviceAlias = String;
pub type PublicKey = String;
pub type EncryptedSymmetricKey = String;
pub type RegisterKeyResult = Result<(), DeviceError>;
pub type SynchronizeKeyResult = Result<EncryptedSymmetricKey, DeviceError>;

/// デバイスのエイリアスと鍵を紐付けて保存する構造体
#[derive(CandidType, Clone, Serialize, Deserialize)]
pub struct DeviceData {
    pub aliases: HashMap<DeviceAlias, PublicKey>,
    pub keys: HashMap<PublicKey, EncryptedSymmetricKey>,
}

/// devicesモジュール内のデータを管理する構造体
/// * `devices` - Principalとデバイスデータを紐づけて保存
#[derive(Default)]
pub struct Devices {
    pub devices: HashMap<Principal, DeviceData>,
}

/// メソッド
impl Devices {

    /// 指定したPrincipalとデバイスデータを紐付けて登録するメソッド
    pub fn register_device(
        &mut self,
        caller: Principal,
        alias: DeviceAlias,
        public_key: PublicKey,
    ) {
        match self.devices.entry(caller) {
            // 既にプリンシパルが登録されている場合は、デバイスデータを追加します。
            Entry::Occupied(mut device_data_entry) => {
                let device_data = device_data_entry.get_mut();
                match device_data.aliases.entry(alias) {
                    // 既にデバイスエイリアスが登録されている場合は、何もしません。
                    Entry::Occupied(_) => {}
                    // デバイスエイリアスが登録されていない場合は、デバイスエイリアスと公開鍵を紐づけて保存します。
                    Entry::Vacant(alias_entry) => {
                        alias_entry.insert(public_key);
                    }
                }
            }
            // 初めて登録する場合は、プリンシパルとデバイスデータを紐づけて保存します。
            Entry::Vacant(empty_device_data_entry) => {
                let mut device_data = DeviceData {
                    aliases: HashMap::new(),
                    keys: HashMap::new(),
                };
                // デバイスエイリアスと公開鍵を紐づけて保存します。
                device_data.aliases.insert(alias, public_key);
                empty_device_data_entry.insert(device_data);
            }
        }
    }

    /// 指定したPrincipalが持つデバイスエイリアス一覧を取得します。
    pub fn get_device_aliases(&self, caller: Principal) -> Vec<DeviceAlias> {
        self.devices
            .get(&caller)
            .map(|device_data| device_data.aliases.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// 指定したPrincipalのデバイスから、エイリアスが一致するデバイスを削除します。
    pub fn delete_device(
        &mut self, 
        caller: Principal, 
        alias: DeviceAlias
    ) {
        if let Some(device_data) = self.devices.get_mut(&caller) {
            // プリンシパルは、必ず1つ以上のデバイスエイリアスが紐づいているものとします。
            assert!(device_data.aliases.len() > 1);

            let public_key = device_data.aliases.remove(&alias);
            if let Some(public_key) = public_key {
                device_data.keys.remove(&public_key);
            }
        }
    }

    /// 指定した公開鍵に紐づいている対称鍵を取得します。
    pub fn get_encrypted_symmetric_key(
        &mut self,
        caller: Principal,
        public_key: &PublicKey,
    ) -> SynchronizeKeyResult {
        match self.devices.get_mut(&caller) {
            Some(device_data) => {
                // 公開鍵が登録されているものであるかどうかを確認します。
                if !Self::is_registered_public_key(device_data, public_key) {
                    return Err(DeviceError::UnknownPublicKey);
                }
                match device_data.keys.get(public_key) {
                    // 対称鍵が登録されている場合は、暗号化された対称鍵を返します。
                    Some(encrypted_symmetric_key) => Ok(encrypted_symmetric_key.clone()),
                    // 対称鍵が登録されていない場合は、エラーとします。
                    None => Err(DeviceError::KeyNotSynchronized),
                }
            }
            // プリンシパルが登録されていない場合は、エラーとします。
            None => Err(DeviceError::DeviceNotRegistered),
        }
    }

    /// 対称鍵を持っていない公開鍵の一覧を取得します。
    pub fn get_unsynced_public_keys(&mut self, caller: Principal) -> Vec<PublicKey> {
        match self.devices.get_mut(&caller) {
            // 登録されている公開鍵のうち、対称鍵が登録されていないものをベクターで返します。
            Some(device_data) => device_data
                .aliases
                .values()
                .filter(|public_key| !device_data.keys.contains_key(*public_key))
                .cloned()
                .collect(),
            None => Vec::new(),
        }
    }

    /// 指定したPrincipalが対称鍵を持っているかどうかを確認するための関数です。
    /// # Returns
    /// * `true` - 既に対称鍵が登録されている場合
    /// * `false` - 対称鍵が登録されていない場合
    pub fn is_encrypted_symmetric_key_registered(&self, caller: Principal) -> bool {
        self.devices
            .get(&caller)
            .map_or(false, |device_data| !device_data.keys.is_empty())
    }

    /// 指定したPrincipalのデバイスデータに、対称鍵を登録します。
    pub fn register_encrypted_symmetric_key(
        &mut self,
        caller: Principal,
        public_key: PublicKey,
        encrypted_symmetric_key: EncryptedSymmetricKey,
    ) -> RegisterKeyResult {
        match self.devices.get_mut(&caller) {
            Some(device_data) => {
                // 登録しようとしている公開鍵が、デバイスデータの登録時に既に登録されているものかどうかを確認します。
                if !Self::is_registered_public_key(device_data, &public_key) {
                    return Err(DeviceError::UnknownPublicKey);
                }
                // 既に対称鍵が登録されている場合は、エラーとします。
                if !device_data.keys.is_empty() {
                    return Err(DeviceError::AlreadyRegistered);
                }
                device_data.keys.insert(public_key, encrypted_symmetric_key);
                Ok(())
            }
            // プリンシパルが登録されていない場合は、エラーとします。
            None => Err(DeviceError::DeviceNotRegistered),
        }
    }

    /// 指定したPrincipalのデバイスデータに、公開鍵と対称鍵のペアを登録します。
    pub fn upload_encrypted_symmetric_keys(
        &mut self,
        caller: Principal,
        keys: Vec<(PublicKey, EncryptedSymmetricKey)>,
    ) -> RegisterKeyResult {
        match self.devices.get_mut(&caller) {
            Some(device_data) => {
                for (public_key, encrypted_symmetric_key) in keys {
                    if !Self::is_registered_public_key(device_data, &public_key) {
                        return Err(DeviceError::UnknownPublicKey);
                    }
                    device_data.keys.insert(public_key, encrypted_symmetric_key);
                }
                Ok(())
            }
            None => Err(DeviceError::DeviceNotRegistered),
        }
    }

    /// 指定したデバイスデータに、公開鍵が登録されているかどうかを確認するための関数です。
    fn is_registered_public_key(
        device_data: &DeviceData, 
        public_key: &PublicKey
    ) -> bool {
        device_data.aliases.values().any(|key| key == public_key)
    }
}
