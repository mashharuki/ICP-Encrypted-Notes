use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// IDと暗号化されたデータを持つ構造体
#[derive(CandidType, Clone, Serialize, Deserialize)]
pub struct EncryptedNote {
    pub id: u128,
    pub data: String,
}

/// notesモジュール内のデータを管理する構造体
/// * `notes` - Principalとノートの一覧を紐づけて保存します。
/// * `counter` - ノートのIDを生成するためのカウンターです。
#[derive(Default)]
pub struct Notes {
    pub notes: HashMap<Principal, Vec<EncryptedNote>>,
    pub counter: u128,
}

/// 関数を実装
impl Notes {
    /// 指定したPrincipalが持つノートを取得するメソッド
    pub fn get_notes(&self, caller: Principal) -> Vec<EncryptedNote> {
        self.notes.get(&caller).cloned().unwrap_or_default()
    }

    /// 新しいノートを追加するメソッド
    pub fn add_note(&mut self, caller: Principal, data: String) {
        let notes_of_caller = self.notes.entry(caller).or_default();

        notes_of_caller.push(EncryptedNote {
            id: self.counter,
            data,
        });
        self.counter += 1;
    }

    /// 指定したPrincipalのノートから、IDが一致するノートを削除するメソッド
    pub fn delete_note(&mut self, caller: Principal, id: u128) {
        if let Some(notes_of_caller) = self.notes.get_mut(&caller) {
            notes_of_caller.retain(|n| n.id != id); // 条件式がtrueのものだけ残します。
        }
    }

    /// 指定したPrincipalのノートから、IDが一致するノートを更新するメソッド
    pub fn update_note(&mut self, caller: Principal, new_note: EncryptedNote) {
        if let Some(current_note) = self
            .notes
            .get_mut(&caller)
            .and_then(|notes_of_caller| notes_of_caller.iter_mut().find(|n| n.id == new_note.id))
        {
            current_note.data = new_note.data;
        }
    }
}
