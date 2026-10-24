use crate::{crypto, schema};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use url::Url;

pub const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FileChunk {
    pub offset: u64,
    pub size: u64,
    pub sha256: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GameFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub executable: bool,
    pub chunks: Vec<FileChunk>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameRelease {
    pub schema_version: u32,
    pub game_id: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub minimum_launcher_version: String,
    pub engine: String,
    pub entrypoint: String,
    pub working_directory: String,
    pub arguments: Vec<String>,
    pub save_directory_name: String,
    pub total_size: u64,
    pub files: Vec<GameFile>,
    pub published_at: String,
    pub signature: String,
}

/// 重複フィールドや整数以外のサイズを見落とさないよう元の JSON バイト列を解析する
///
/// # 引数
///
/// * `bytes` - 処理対象のバイト列
///
/// # 戻り値
///
/// 構造と整合性を検証済みのゲームリリース
pub fn parse(bytes: &[u8]) -> Result<GameRelease> {
    ensure!(bytes.len() <= MAX_MANIFEST_BYTES, "manifest exceeds 16 MiB");
    let release: GameRelease = serde_json::from_slice(bytes).context("invalid release JSON")?;
    validate(&release)?;
    Ok(release)
}

/// 配信先の信頼設定とは独立してスキーマとフィールド間の整合性を検証する
///
/// # 引数
///
/// * `release` - 処理対象のゲームリリース
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn validate(release: &GameRelease) -> Result<()> {
    // スキーマと署名の形式、起動パスを検証する
    schema::validate(&serde_json::to_value(release)?, "game-release.schema.json")?;
    crypto::signature(&release.signature)?;
    schema::relative_path(&release.entrypoint)?;
    schema::working_directory(&release.working_directory)?;

    // ファイルの重複とチャンクの連続性を確認して総サイズを集計する
    let mut paths = BTreeSet::new();
    let mut total = 0u64;
    for file in &release.files {
        schema::relative_path(&file.path)?;
        ensure!(
            paths.insert(&file.path),
            "duplicate file path: {}",
            file.path
        );
        let mut offset = 0u64;
        for chunk in &file.chunks {
            ensure!(chunk.offset == offset, "noncontiguous chunk: {}", file.path);
            offset = offset
                .checked_add(chunk.size)
                .context("chunk size overflow")?;
            ensure!(offset <= file.size, "chunk exceeds file: {}", file.path);
            distribution_url(&chunk.url)?;
        }
        ensure!(offset == file.size, "chunk size mismatch: {}", file.path);
        total = total
            .checked_add(file.size)
            .context("total size overflow")?;
    }

    // 起動ファイルの存在と宣言された総サイズを照合する
    ensure!(
        paths.contains(&release.entrypoint),
        "entrypoint is absent from files"
    );
    ensure!(total == release.total_size, "manifest total size mismatch");
    Ok(())
}

/// 認証情報やフラグメント、不明確な区切り文字を拒否して配信 URL を解析する
///
/// # 引数
///
/// * `value` - 検証対象の文字列
///
/// # 戻り値
///
/// 配信条件を満たす解析済み URL
pub fn distribution_url(value: &str) -> Result<Url> {
    ensure!(
        !value
            .chars()
            .any(|c| c.is_control() || c == '\\' || c.is_whitespace()),
        "invalid distribution URL"
    );

    // 認証情報とフラグメントを拒否して配信先の条件を確認する
    let url = Url::parse(value).context("invalid distribution URL")?;
    ensure!(
        url.username().is_empty() && url.password().is_none() && url.fragment().is_none(),
        "invalid distribution URL authority or fragment"
    );
    let host = url.host_str().context("distribution URL has no host")?;
    let loopback = url.scheme() == "http" && matches!(host, "localhost" | "127.0.0.1");
    ensure!(
        url.scheme() == "https" || loopback,
        "distribution URL must use HTTPS"
    );
    Ok(url)
}

/// 利用側で固定した許可ホスト一覧に配信先が含まれることを検証する
///
/// # 引数
///
/// * `release` - 処理対象のゲームリリース
/// * `allowed_hosts` - 配信を許可するホスト名の一覧
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn validate_hosts(release: &GameRelease, allowed_hosts: &[String]) -> Result<()> {
    for file in &release.files {
        for chunk in &file.chunks {
            let url = distribution_url(&chunk.url)?;
            let host = url.host_str().context("missing distribution host")?;
            ensure!(
                allowed_hosts
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(host)),
                "untrusted distribution host: {host}"
            );
        }
    }
    Ok(())
}

/// 署名フィールドだけを除外してリリースを正規化する
///
/// # 引数
///
/// * `release` - 処理対象のゲームリリース
///
/// # 戻り値
///
/// 署名フィールドを除いた正規化済み JSON のバイト列
pub fn signing_payload(release: &GameRelease) -> Result<Vec<u8>> {
    let mut document = serde_json::to_value(release)?;
    document
        .as_object_mut()
        .context("release object")?
        .remove("signature");
    schema::canonical_json(&document)
}

/// スキーマ、整合性、許可ホスト、署名の検証を通過したリリースを返す
///
/// # 引数
///
/// * `bytes` - 処理対象のバイト列
/// * `encoded_key` - Base64 形式の固定公開鍵
/// * `allowed_hosts` - 配信を許可するホスト名の一覧
///
/// # 戻り値
///
/// 署名と配信条件を検証済みのゲームリリース
pub fn verify(bytes: &[u8], encoded_key: &str, allowed_hosts: &[String]) -> Result<GameRelease> {
    // 元の JSON の構造とホストの許可条件を確認する
    let release = parse(bytes)?;
    validate_hosts(&release, allowed_hosts)?;

    // 署名対象を正規化して固定公開鍵で真正性を検証する
    crypto::verify(&signing_payload(&release)?, &release.signature, encoded_key)?;
    Ok(release)
}
