use anyhow::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use pandd_distribution_contracts::{
    crypto,
    manifest::{self, MAX_MANIFEST_BYTES},
    schema,
};
use serde_json::{Value, json};

const RELEASE: &[u8] = include_bytes!("fixtures/release.json");
const KEY: &str = include_str!("fixtures/public-key.txt");

/// 両方の利用側で使う固定の配信ホストを用意する
fn hosts() -> Vec<String> {
    vec!["downloads.koto-thing.com".to_owned()]
}

/// 不正な契約データの検証用に変更可能な JSON を読み込む
fn document() -> Value {
    serde_json::from_slice(RELEASE).unwrap()
}

/// 固定のテスト公開鍵で正規化したバイト列と署名の一致を確認する
#[test]
fn fixed_signature_and_unicode_round_trip() -> Result<()> {
    let release = manifest::verify(RELEASE, KEY.trim(), &hosts())?;
    assert_eq!(release.game_id, "sample-game");
    assert_eq!(
        release.files[0].chunks[0].url,
        "https://downloads.koto-thing.com/blobs/sha256/value"
    );
    let key = SigningKey::from_bytes(&[7; 32]);
    assert_eq!(STANDARD.encode(key.verifying_key().as_bytes()), KEY.trim());
    assert_eq!(
        STANDARD.encode(key.sign(&manifest::signing_payload(&release)?).to_bytes()),
        release.signature
    );
    assert!(crypto::public_key(&format!("{}!", KEY.trim())).is_err());
    assert!(crypto::signature(&format!("{}\n", release.signature)).is_err());
    Ok(())
}

/// 正規化で重複キーや小数が隠れる前に不正な元の JSON を拒否する
#[test]
fn original_json_is_strict() {
    let original = std::str::from_utf8(RELEASE).unwrap();
    for text in [
        original.replace(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
        ),
        original.replace("\"offset\":0", "\"offset\":0,\"offset\":0"),
        original.replace("\"totalSize\":4", "\"totalSize\":4.0"),
        original.replace("\"totalSize\":4", "\"totalSize\":4e0"),
        original.replace("\"totalSize\":4", "\"totalSize\":18446744073709551616"),
        original.replace("\"totalSize\":4", "\"totalSize\":-1"),
        original.replacen('{', "{\"unknown\":true,", 1),
        original.replace("\"executable\":true,", ""),
    ] {
        assert!(manifest::parse(text.as_bytes()).is_err(), "{text}");
    }
    assert!(manifest::parse(&[0xff]).is_err());
    assert!(manifest::parse(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
}

/// 共有バリデータでファイル、チャンク、総サイズ、起動ファイル、パスの規則を検証する
#[test]
fn malformed_semantics_are_rejected() -> Result<()> {
    for (pointer, value) in [
        ("/files/0/chunks/0/offset", json!(1)),
        ("/files/0/chunks/0/size", json!(u64::MAX)),
        ("/files/0/chunks/0/size", json!(268435457u64)),
        ("/files/0/chunks/0/size", json!(0)),
        ("/files/0/chunks/0/sha256", json!("A".repeat(64))),
        ("/files/0/size", json!(17179869185u64)),
        ("/totalSize", json!(5)),
        ("/entrypoint", json!("absent.exe")),
        ("/files/0/path", json!("../outside.exe")),
        ("/files/0/path", json!("C:/outside.exe")),
        ("/workingDirectory", json!("a//b")),
        ("/arguments", json!(["--execute"])),
        ("/signature", json!("!".repeat(88))),
        ("/publishedAt", json!("not-a-time")),
        ("/engine", json!("unknown")),
    ] {
        let mut input = document();
        *input.pointer_mut(pointer).unwrap() = value;
        assert!(
            manifest::parse(&serde_json::to_vec(&input)?).is_err(),
            "{pointer}"
        );
    }
    let mut input = document();
    input["files"] = json!([input["files"][0], input["files"][0]]);
    input["totalSize"] = json!(8);
    assert!(manifest::parse(&serde_json::to_vec(&input)?).is_err());
    let mut input = document();
    input["files"] = json!(vec![input["files"][0].clone(); 10001]);
    assert!(manifest::parse(&serde_json::to_vec(&input)?).is_err());
    Ok(())
}

/// Publisher の内容規則とランチャーの固定ホストによる信頼規則を区別する
#[test]
fn host_and_signature_policies_are_enforced() -> Result<()> {
    assert!(manifest::verify(RELEASE, KEY.trim(), &["evil.example".into()]).is_err());
    assert!(manifest::verify(RELEASE, KEY.trim(), &[]).is_err());
    let mut input = document();
    input["version"] = json!("1.2.4");
    assert!(manifest::parse(&serde_json::to_vec(&input)?).is_ok());
    assert!(manifest::verify(&serde_json::to_vec(&input)?, KEY.trim(), &hosts()).is_err());
    for url in [
        "https://downloads.koto-thing.com@evil.example/blob",
        "https://downloads.koto-thing.com.evil.example/blob",
        "http://downloads.koto-thing.com/blob",
        "http://notlocalhost.example/blob",
        "https://downloads.koto-thing.com\\@evil.example/blob",
        "https://user@downloads.koto-thing.com/blob",
        "https://downloads.koto-thing.com:99999/blob",
    ] {
        let mut input = document();
        input["files"][0]["chunks"][0]["url"] = json!(url);
        let result = manifest::parse(&serde_json::to_vec(&input)?)
            .and_then(|release| manifest::validate_hosts(&release, &hosts()));
        assert!(result.is_err(), "{url}");
    }
    let mut input = document();
    input["files"][0]["chunks"][0]["url"] = json!("http://127.0.0.1:8080/blob");
    manifest::validate_hosts(
        &manifest::parse(&serde_json::to_vec(&input)?)?,
        &["127.0.0.1".into()],
    )?;
    Ok(())
}

/// ルート作業ディレクトリと異なる言語間の JSON 表現の一致を確認する
#[test]
fn root_entrypoint_and_canonical_json_are_supported() -> Result<()> {
    let mut input = document();
    input["entrypoint"] = json!("game.exe");
    input["workingDirectory"] = json!(".");
    input["files"][0]["path"] = json!("game.exe");
    manifest::parse(&serde_json::to_vec(&input)?)?;
    assert_eq!(
        schema::canonical_json(&json!({"z":1,"a":"日本語"}))?,
        "{\"a\":\"日本語\",\"z\":1}".as_bytes()
    );
    Ok(())
}
