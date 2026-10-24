use anyhow::{Result, bail};
use pandd_distribution_contracts::{CHUNK_SIZE, schema as contracts};
use pandd_publisher::{
    files, gc, release,
    storage::{self, ObjectStore, Phase},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, collections::BTreeMap, fs, io::Write, path::Path};
use tempfile::tempdir;

#[derive(Default)]
struct Store {
    metadata: RefCell<BTreeMap<String, Value>>,
    documents: BTreeMap<String, Value>,
    uploads: RefCell<Vec<String>>,
    deletions: RefCell<Vec<String>>,
    fail_head: bool,
    corrupt_upload: bool,
}

impl ObjectStore for Store {
    /// オブジェクトの欠落と通信の失敗を再現する
    fn head(&self, key: &str) -> Result<Option<Value>> {
        if self.fail_head {
            bail!("network failure");
        }
        Ok(self.metadata.borrow().get(key).cloned())
    }

    /// 書込を記録し必要に応じてリモートの整合性検証失敗を再現する
    fn put(&self, key: &str, _: &Path, metadata: &Value, _: bool) -> Result<()> {
        self.uploads.borrow_mut().push(key.into());
        let mut metadata = metadata.clone();
        if self.corrupt_upload {
            metadata["size"] = json!(999);
        }
        self.metadata.borrow_mut().insert(key.into(), metadata);
        Ok(())
    }

    /// 保持規則のテスト用に一定の古いオブジェクトを返す
    fn inventory(&self) -> Result<Vec<Value>> {
        Ok(self
            .documents
            .keys()
            .map(|key| json!({"Key": key, "LastModified": "2020-01-01T00:00:00Z"}))
            .collect())
    }

    /// 保存した保持対象のマニフェストを読み込む
    fn read_json(&self, key: &str) -> Result<Value> {
        Ok(self.documents[key].clone())
    }

    /// リモートへ接続せず削除対象を記録する
    fn delete(&self, key: &str) -> Result<()> {
        self.deletions.borrow_mut().push(key.into());
        Ok(())
    }
}

/// 公開ポインタ更新前の転送順序と各失敗条件を検証する
#[test]
fn uploads_verify_immutable_objects_before_latest() -> Result<()> {
    let directory = tempdir()?;
    let root = directory.path();
    let blob = "v1/blobs/sha256/blob";
    let latest = "v1/games/sample/releases/windows/x86_64/latest.json";
    let catalog = "v1/catalog/ja-JP/windows/x86_64.json";
    for key in [blob, latest, catalog] {
        let path = root.join(key);
        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(path, key)?;
    }

    let store = Store::default();
    storage::upload(root, &store, Phase::Immutable)?;
    assert_eq!(*store.uploads.borrow(), [blob]);
    storage::upload(root, &store, Phase::Pointers)?;
    assert_eq!(*store.uploads.borrow(), [blob, catalog, latest]);

    for failing in [
        Store::default(),
        Store {
            fail_head: true,
            ..Store::default()
        },
    ] {
        assert!(storage::upload(root, &failing, Phase::Pointers).is_err());
        assert!(failing.uploads.borrow().is_empty());
    }

    let corrupt = Store {
        corrupt_upload: true,
        ..Store::default()
    };
    assert!(storage::upload(root, &corrupt, Phase::All).is_err());
    assert_eq!(*corrupt.uploads.borrow(), [blob]);

    let conflict = Store::default();
    conflict
        .metadata
        .borrow_mut()
        .insert(blob.into(), json!({"size": 0}));
    assert!(storage::upload(root, &conflict, Phase::All).is_err());
    assert!(conflict.uploads.borrow().is_empty());
    Ok(())
}

/// 現在版、直前版、旧版、中断版を含む一覧を用意する
fn retention_store() -> Store {
    let mut store = Store::default();
    let root = "v1/games/sample/releases/windows/x86_64";
    store
        .documents
        .insert(format!("{root}/latest.json"), json!({"version": "2.0.0"}));
    for (version, byte) in [
        ("1.9.0", 'a'),
        ("1.10.0", 'b'),
        ("2.0.0", 'c'),
        ("3.0.0", 'd'),
    ] {
        let digest = byte.to_string().repeat(64);
        store.documents.insert(
            format!("{root}/{version}/manifest.json"),
            json!({"files": [{"chunks": [{"sha256": digest}]}]}),
        );
        store
            .documents
            .insert(format!("v1/blobs/sha256/{digest}"), Value::Null);
    }
    store
}

/// バージョン順で直前の版を保持し削除前に不完全な一覧を拒否する
#[test]
fn cleanup_retains_current_previous_and_fails_closed() -> Result<()> {
    let store = retention_store();
    let removed = gc::remote(&store, 7, true)?;
    assert_eq!(removed.len(), 4);
    assert!(removed[0].contains("1.9.0/manifest.json"));
    assert!(removed[1].contains("3.0.0/manifest.json"));
    assert!(store.deletions.borrow().is_empty());
    assert_eq!(gc::remote(&store, 7, false)?, removed);
    assert_eq!(*store.deletions.borrow(), removed);

    let mut missing = retention_store();
    missing
        .documents
        .remove("v1/games/sample/releases/windows/x86_64/2.0.0/manifest.json");
    assert!(gc::remote(&missing, 7, false).is_err());
    assert!(missing.deletions.borrow().is_empty());
    let mut missing_blob = retention_store();
    missing_blob
        .documents
        .remove(&format!("v1/blobs/sha256/{}", "c".repeat(64)));
    assert!(gc::remote(&missing_blob, 7, false).is_err());
    assert!(missing_blob.deletions.borrow().is_empty());
    assert!(gc::remote(&store, 6, false).is_err());
    Ok(())
}

/// ローカルの整理で同じ計画を使い新しいファイルを保護することを確認する
#[test]
fn local_cleanup_keeps_fresh_unreferenced_content() -> Result<()> {
    let directory = tempdir()?;
    let root = directory.path();
    for (key, document) in retention_store().documents {
        let path = root.join(key);
        files::write_json(&path, &document)?;
        fs::File::options()
            .write(true)
            .open(&path)?
            .set_modified(std::time::UNIX_EPOCH)?;
    }
    fs::write(root.join("v1/blobs/sha256/fresh"), b"fresh")?;
    assert_eq!(gc::local(root, 7, true)?.len(), 4);
    assert!(
        root.join("v1/games/sample/releases/windows/x86_64/1.9.0/manifest.json")
            .exists()
    );
    assert_eq!(gc::local(root, 7, false)?.len(), 4);
    assert!(root.join("v1/blobs/sha256/fresh").exists());
    assert!(
        !root
            .join("v1/games/sample/releases/windows/x86_64/1.9.0")
            .exists()
    );
    Ok(())
}

/// 分割の境界、全体ハッシュ、重複排除、壊れたローカルチャンクを検証する
#[test]
fn chunks_preserve_the_wire_format_and_detect_corruption() -> Result<()> {
    let directory = tempdir()?;
    let source = directory.path().join("game.bin");
    let mut file = fs::File::create(&source)?;
    let bytes = vec![42; CHUNK_SIZE];
    file.write_all(&bytes)?;
    file.write_all(b"tail")?;
    drop(file);
    let output = directory.path().join("output");
    let manifest = files::chunk_file(&source, &output, "https://example.test")?;
    assert_eq!(manifest["chunks"][0]["size"], CHUNK_SIZE);
    assert_eq!(manifest["chunks"][1]["offset"], CHUNK_SIZE);
    assert_eq!(manifest["chunks"][1]["size"], 4);
    assert_eq!(
        manifest["sha256"],
        pandd_file_integrity::hash_file(&source)?
    );
    assert_eq!(
        manifest,
        files::chunk_file(&source, &output, "https://example.test")?
    );
    let digest = format!("{:x}", Sha256::digest(&bytes));
    fs::write(output.join(format!("v1/blobs/sha256/{digest}")), b"corrupt")?;
    assert!(files::chunk_file(&source, &output, "https://example.test").is_err());
    fs::write(&source, b"")?;
    assert!(files::chunk_file(&source, &output, "https://example.test").is_err());
    Ok(())
}

/// ネットワーク接続なしでスキーマ、国際化名、パスの安全性を検証する
#[test]
fn contracts_enforce_formats_locales_and_paths() -> Result<()> {
    for path in [
        "",
        "../escape",
        "a/../b",
        "/abs",
        "C:/abs",
        "a\\b",
        "a//b",
        "./a",
        "a/.",
        "a/",
        "a:b",
    ] {
        assert!(contracts::relative_path(path).is_err(), "{path}");
    }
    assert!(contracts::relative_path("日本語/game.exe").is_ok());
    assert!(contracts::working_directory(".").is_ok());
    for locale in ["ja-JP", "ko-KR", "zh-Hans", "en"] {
        contracts::locale(locale)?;
    }
    for locale in ["../ja", "en/US", "j", "en_"] {
        assert!(contracts::locale(locale).is_err());
    }
    let mut metadata: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/examples/game-release.source.json"
    ))?;
    contracts::validate(&metadata, "game-release-source.schema.json")?;
    metadata["publishedAt"] = json!("not-a-date");
    assert!(contracts::validate(&metadata, "game-release-source.schema.json").is_err());
    assert_eq!(
        contracts::canonical_json(&json!({"z": 1, "a": "日本語"}))?,
        "{\"a\":\"日本語\",\"z\":1}".as_bytes()
    );
    Ok(())
}

/// 繰り返しのビルドで署名と不変マニフェストが保持されることを確認する
#[test]
fn signed_release_is_idempotent_and_rejects_changed_content() -> Result<()> {
    let directory = tempdir()?;
    let root = directory.path();
    let build = root.join("build");
    let output = root.join("output");
    fs::create_dir_all(build.join("bin"))?;
    fs::write(build.join("bin/game.exe"), b"game")?;
    fs::write(root.join("hero.png"), b"hero")?;
    fs::write(root.join("thumbnail.png"), b"thumbnail")?;
    let metadata = root.join("release.json");
    files::write_json(
        &metadata,
        &json!({"gameId": "sample-game", "version": "1.0.0", "minimumLauncherVersion": "1.0.0",
        "publishedAt": "2026-08-10T00:00:00Z", "engine": "godot", "entrypoint": "bin/game.exe", "workingDirectory": "bin",
        "saveDirectoryName": "sample-game", "display": {"ja-JP": {"name": "サンプル", "summary": "説明"}},
        "hero": "hero.png", "thumbnail": "thumbnail.png", "heroFocalPoint": {"x": 0.5, "y": 0.5}}),
    )?;
    let private = root.join("private.pem");
    let public = root.join("public.pem");
    release::create_key(&private, &public)?;
    assert!(release::create_key(&private, &public).is_err());
    release::build_game(
        &metadata,
        &build,
        &output,
        "https://example.test",
        &private,
        "windows",
        "x86_64",
    )?;
    let manifest_path =
        output.join("v1/games/sample-game/releases/windows/x86_64/1.0.0/manifest.json");
    let first = fs::read(&manifest_path)?;
    release::build_game(
        &metadata,
        &build,
        &output,
        "https://example.test",
        &private,
        "windows",
        "x86_64",
    )?;
    assert_eq!(fs::read(&manifest_path)?, first);

    let key = ed25519_dalek::VerifyingKey::from_public_key_pem(&fs::read_to_string(&public)?)?;
    let encoded_key = base64::engine::general_purpose::STANDARD.encode(key.as_bytes());
    let verified = pandd_distribution_contracts::manifest::verify(
        &first,
        &encoded_key,
        &["example.test".into()],
    )?;
    assert_eq!(verified.entrypoint, "bin/game.exe");
    assert_eq!(verified.total_size, 4);

    use base64::Engine;
    use ed25519_dalek::{Signature, VerifyingKey, pkcs8::DecodePublicKey};
    let mut document = files::read_json(&manifest_path)?;
    let signature = document
        .as_object_mut()
        .unwrap()
        .remove("signature")
        .unwrap();
    let signature =
        base64::engine::general_purpose::STANDARD.decode(signature.as_str().unwrap())?;
    VerifyingKey::from_public_key_pem(&fs::read_to_string(public)?)?.verify_strict(
        &contracts::canonical_json(&document)?,
        &Signature::from_slice(&signature)?,
    )?;

    fs::write(build.join("bin/game.exe"), b"changed")?;
    assert!(
        release::build_game(
            &metadata,
            &build,
            &output,
            "https://example.test",
            &private,
            "windows",
            "x86_64"
        )
        .is_err()
    );
    assert_eq!(fs::read(&manifest_path)?, first);

    Ok(())
}
