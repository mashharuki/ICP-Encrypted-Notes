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
}
