use crate::{check_cancelled, files};
use anyhow::{Context, Result, ensure};
use chrono::{SecondsFormat, Utc};
use ed25519_dalek::{
    SigningKey,
    pkcs8::{EncodePrivateKey, EncodePublicKey, spki::der::pem::LineEnding},
};
use pandd_distribution_contracts::{crypto, manifest, schema as contracts};
use rayon::prelude::*;
use serde_json::{Value, json};
use std::{fs, io::Write, path::Path};

/// Format publication timestamps consistently in UTC
fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Generate an OpenSSL-compatible Ed25519 keypair without overwriting keys
pub fn create_key(private: &Path, public: &Path) -> Result<()> {
    ensure!(
        !private.exists() && !public.exists() && private != public,
        "refusing to overwrite an existing signing key"
    );
    let key = SigningKey::generate(&mut rand::rngs::OsRng);
    for path in [private, public] {
        fs::create_dir_all(path.parent().context("key parent")?)?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options
        .open(private)?
        .write_all(key.to_pkcs8_pem(LineEnding::LF)?.as_bytes())?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(public)?
        .write_all(
            key.verifying_key()
                .to_public_key_pem(LineEnding::LF)?
                .as_bytes(),
        )?;
    Ok(())
}

/// Sign canonical release bytes using the existing PKCS#8 PEM key format
pub fn sign_payload(payload: &[u8], private: &Path) -> Result<String> {
    crypto::sign(payload, &fs::read_to_string(private)?)
}

/// Build signed immutable releases and localized catalogs before updating latest
pub fn build_game(
    metadata_path: &Path,
    build: &Path,
    output: &Path,
    base_url: &str,
    private: &Path,
    platform: &str,
    arch: &str,
) -> Result<()> {
    let metadata = files::read_json(metadata_path)?;
    contracts::validate(&metadata, "game-release-source.schema.json")?;
    let text = |key: &str| metadata[key].as_str().context("missing metadata string");
    let game_id = text("gameId")?;
    let version = text("version")?;
    let entrypoint = contracts::relative_path(text("entrypoint")?)?;
    contracts::working_directory(text("workingDirectory")?)?;
    ensure!(
        ["windows", "macos", "linux"].contains(&platform) && ["x86_64", "arm64"].contains(&arch),
        "unsupported platform or architecture"
    );

    let sources = files::regular_files(build)?;
    ensure!(
        sources
            .iter()
            .any(|path| files::object_key(path, build).is_ok_and(|key| key == entrypoint)),
        "entrypoint must exist inside the build directory"
    );
    fs::create_dir_all(output)?;
    ensure!(
        !output.canonicalize()?.starts_with(build.canonicalize()?),
        "output must be outside the build directory"
    );

    // Bound memory to four chunk buffers while processing independent files in parallel
    let threads = std::thread::available_parallelism()?.get().min(4);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()?;
    let files: Vec<Value> = pool.install(|| {
        sources
            .par_iter()
            .map(|source| -> Result<Value> {
                let relative = files::object_key(source, build)?;
                contracts::relative_path(&relative)?;
                let mut document = files::chunk_file(source, output, base_url)?;
                let mut executable = relative == entrypoint;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    executable |= fs::metadata(source)?.permissions().mode() & 0o111 != 0;
                }

                #[cfg(windows)]
                {
                    executable = executable || source.is_file();
                }

                document["path"] = json!(relative);
                document["executable"] = json!(executable);
                Ok(document)
            })
            .collect::<Result<Vec<_>>>()
    })?;

    let mut manifest = json!({
        "schemaVersion": 1, "gameId": game_id, "version": version, "platform": platform, "arch": arch,
        "minimumLauncherVersion": metadata["minimumLauncherVersion"], "engine": metadata["engine"],
        "entrypoint": entrypoint, "workingDirectory": metadata["workingDirectory"], "arguments": [],
        "saveDirectoryName": metadata["saveDirectoryName"], "publishedAt": metadata["publishedAt"],
        "totalSize": files.iter().map(|file| file["size"].as_u64().unwrap()).sum::<u64>(), "files": files,
    });
    manifest["signature"] = json!("");
    let mut release: manifest::GameRelease = serde_json::from_value(manifest)?;
    release.signature = sign_payload(&manifest::signing_payload(&release)?, private)?;
    manifest::validate(&release)?;
    let origin = manifest::distribution_url(base_url)?;
    manifest::validate_hosts(
        &release,
        &[origin.host_str().context("distribution host")?.to_owned()],
    )?;
    let manifest = serde_json::to_value(&release)?;
    check_cancelled()?;
    let root = format!("v1/games/{game_id}/releases/{platform}/{arch}");
    let immutable = output.join(format!("{root}/{version}/manifest.json"));
    if immutable.exists() {
        ensure!(
            files::read_json(&immutable)? == manifest,
            "refusing to overwrite an immutable release manifest"
        );
    } else {
        files::store_bytes(&immutable, &serde_json::to_vec_pretty(&manifest)?)?;
    }

    let asset_root = metadata_path.parent().context("metadata directory")?;
    let hero = files::copy_asset(
        &asset_root.join(contracts::relative_path(text("hero")?)?),
        output,
        base_url,
    )?;
    let thumbnail = files::copy_asset(
        &asset_root.join(contracts::relative_path(text("thumbnail")?)?),
        output,
        base_url,
    )?;
    let latest = format!("{root}/latest.json");
    for (locale, display) in metadata["display"].as_object().context("display object")? {
        check_cancelled()?;
        contracts::locale(locale)?;
        let path = output.join(format!("v1/catalog/{locale}/{platform}/{arch}.json"));
        let mut catalog = if path.exists() {
            files::read_json(&path)?
        } else {
            json!({"schemaVersion": 1, "generatedAt": utc_now(), "games": []})
        };
        contracts::validate(&catalog, "catalog.schema.json")?;
        let games = catalog["games"].as_array_mut().context("catalog games")?;
        games.retain(|game| game["gameId"] != game_id);
        games.push(json!({"gameId": game_id, "name": display["name"], "summary": display["summary"],
            "heroUrl": hero, "thumbnailUrl": thumbnail, "heroFocalPoint": metadata["heroFocalPoint"],
            "latestReleaseUrl": format!("{}/{latest}", base_url.trim_end_matches('/'))}));
        games.sort_by(|a, b| a["gameId"].as_str().cmp(&b["gameId"].as_str()));
        catalog["generatedAt"] = json!(utc_now());
        contracts::validate(&catalog, "catalog.schema.json")?;
        files::write_json(&path, &catalog)?;
    }
    check_cancelled()?;
    files::write_json(&output.join(latest), &manifest)
}

/// Publish reviewed announcements with a fresh generation timestamp
pub fn announcements(source: &Path, output: &Path) -> Result<()> {
    for entry in fs::read_dir(source)? {
        let path = entry?.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let locale = path
            .file_stem()
            .and_then(|s| s.to_str())
            .context("locale file name")?;
        contracts::locale(locale)?;
        let mut document = files::read_json(&path)?;
        contracts::validate(&document, "announcements-source.schema.json")?;
        document["generatedAt"] = json!(utc_now());
        contracts::validate(&document, "announcements.schema.json")?;
        files::write_json(
            &output.join(format!("v1/announcements/{locale}.json")),
            &document,
        )?;
    }
    Ok(())
}

/// Publish platform-specific Qt IFW release metadata
pub fn launcher(
    source: &Path,
    output: &Path,
    base_url: &str,
    locale: &str,
    platform: &str,
    arch: &str,
) -> Result<()> {
    contracts::locale(locale)?;
    let document = files::read_json(source)?;
    contracts::validate(&document, "launcher-release-source.schema.json")?;
    let public = json!({"schemaVersion": 1, "version": document["version"], "mandatory": document["mandatory"],
        "title": document["title"], "publishedAt": document["publishedAt"],
        "ifwRepositoryUrl": format!("{}/v1/launcher/ifw/{platform}/{arch}", base_url.trim_end_matches('/'))});
    contracts::validate(&public, "launcher-release.schema.json")?;
    files::write_json(
        &output.join(format!(
            "v1/launcher/releases/{locale}/{platform}/{arch}/latest.json"
        )),
        &public,
    )
}

/// Publish the dedicated localized changelog source
pub fn changelog(source: &Path, output: &Path, locale: &str) -> Result<()> {
    contracts::locale(locale)?;
    let document = files::read_json(source)?;
    contracts::validate(&document, "launcher-changelog.schema.json")?;
    files::write_json(
        &output.join(format!("v1/launcher/changelog/{locale}.json")),
        &document,
    )
}
