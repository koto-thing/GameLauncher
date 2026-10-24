use anyhow::Result;
use pandd_publisher::{
    CANCELLED,
    storage::{self, ObjectStore, Phase},
};
use serde_json::{Value, json};
use std::{cell::RefCell, fs, path::Path, sync::atomic::Ordering};

struct CancelStore {
    writes: RefCell<Vec<String>>,
}

impl ObjectStore for CancelStore {
    /// 不変オブジェクトの確認直後にキャンセルを要求する
    fn head(&self, _: &str) -> Result<Option<Value>> {
        CANCELLED.store(true, Ordering::Relaxed);
        Ok(Some(
            json!({"size": 4, "sha256": "fa2c8cc4f28176bbeed4b736df569a34c79cd3723e9ec42f9674b4d46ac6b8b8", "contentType": "application/octet-stream"}),
        ))
    }

    /// キャンセルの確認後に誤って進んだ書込を記録する
    fn put(&self, key: &str, _: &Path, _: &Value, _: bool) -> Result<()> {
        self.writes.borrow_mut().push(key.into());
        Ok(())
    }

    /// アップロードのテストでは整理用の一覧を使わない
    fn inventory(&self) -> Result<Vec<Value>> {
        unreachable!()
    }

    /// アップロードのテストではリモート文書を使わない
    fn read_json(&self, _: &str) -> Result<Value> {
        unreachable!()
    }

    /// アップロードのキャンセルで整理処理が呼ばれた場合は失敗する
    fn delete(&self, _: &str) -> Result<()> {
        unreachable!()
    }
}

/// 他の公開テストと別のプロセスでキャンセル状態を管理する
#[test]
fn cancellation_prevents_pointer_promotion() -> Result<()> {
    let directory = tempfile::tempdir()?;
    for key in [
        "v1/blobs/sha256/blob",
        "v1/catalog/ja-JP/windows/x86_64.json",
        "v1/games/sample/releases/windows/x86_64/latest.json",
    ] {
        let path = directory.path().join(key);
        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(path, b"blob")?;
    }
    let store = CancelStore {
        writes: RefCell::new(Vec::new()),
    };
    let error = storage::upload(directory.path(), &store, Phase::Pointers).unwrap_err();
    assert!(error.to_string().contains("cancelled"), "{error}");
    assert!(store.writes.borrow().is_empty());
    Ok(())
}
