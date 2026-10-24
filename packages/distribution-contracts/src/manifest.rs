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

/// Parse the original bytes so duplicate fields and noninteger sizes cannot be normalized away
pub fn parse(bytes: &[u8]) -> Result<GameRelease> {
    ensure!(bytes.len() <= MAX_MANIFEST_BYTES, "manifest exceeds 16 MiB");
    let release: GameRelease = serde_json::from_slice(bytes).context("invalid release JSON")?;
    validate(&release)?;
    Ok(release)
}

/// Check the shared schema and cross-field invariants independently of deployment trust
pub fn validate(release: &GameRelease) -> Result<()> {
    schema::validate(&serde_json::to_value(release)?, "game-release.schema.json")?;
    crypto::signature(&release.signature)?;
    schema::relative_path(&release.entrypoint)?;
    schema::working_directory(&release.working_directory)?;
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
    ensure!(
        paths.contains(&release.entrypoint),
        "entrypoint is absent from files"
    );
    ensure!(total == release.total_size, "manifest total size mismatch");
    Ok(())
}

/// Parse distribution URLs without credentials, fragments, or ambiguous separators
pub fn distribution_url(value: &str) -> Result<Url> {
    ensure!(
        !value
            .chars()
            .any(|c| c.is_control() || c == '\\' || c.is_whitespace()),
        "invalid distribution URL"
    );
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

/// Enforce the consumer's pinned host set without coupling publisher and launcher permissions
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

/// Canonicalize the typed release with only the signature field excluded
pub fn signing_payload(release: &GameRelease) -> Result<Vec<u8>> {
    let mut document = serde_json::to_value(release)?;
    document
        .as_object_mut()
        .context("release object")?
        .remove("signature");
    schema::canonical_json(&document)
}

/// Return a release only after schema, semantics, host policy, and signature all pass
pub fn verify(bytes: &[u8], encoded_key: &str, allowed_hosts: &[String]) -> Result<GameRelease> {
    let release = parse(bytes)?;
    validate_hosts(&release, allowed_hosts)?;
    crypto::verify(&signing_payload(&release)?, &release.signature, encoded_key)?;
    Ok(release)
}
