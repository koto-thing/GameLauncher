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

/// 公開日時を UTC の共通形式にそろえる
///
/// # 戻り値
///
/// 秒精度の UTC 日時を表す RFC 3339 文字列
fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// 既存の鍵を上書きせず OpenSSL 互換の Ed25519 鍵ペアを生成する
///
/// # 引数
///
/// * `private` - PKCS#8 PEM 形式の秘密鍵ファイルのパス
/// * `public` - PEM 形式の公開鍵ファイルの出力先
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
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

/// 既存の PKCS#8 PEM 鍵形式で正規化済みのリリースに署名する
///
/// # 引数
///
/// * `payload` - 署名または検証の対象となる元のバイト列
/// * `private` - PKCS#8 PEM 形式の秘密鍵ファイルのパス
///
/// # 戻り値
///
/// Base64 形式の Ed25519 署名
pub fn sign_payload(payload: &[u8], private: &Path) -> Result<String> {
    crypto::sign(payload, &fs::read_to_string(private)?)
}

/// 署名済みの不変リリースと言語別カタログを構築してから latest を更新する
///
/// # 引数
///
/// * `metadata_path` - ゲーム公開用メタデータの JSON ファイル
/// * `build` - 配信するビルドのルートディレクトリ
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `base_url` - 配信先の基準 URL
/// * `private` - PKCS#8 PEM 形式の秘密鍵ファイルのパス
/// * `platform` - 対象 OS、windows・macos・linux のいずれか
/// * `arch` - 対象 CPU、x86_64 または arm64
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn build_game(
    metadata_path: &Path,
    build: &Path,
    output: &Path,
    base_url: &str,
    private: &Path,
    platform: &str,
    arch: &str,
) -> Result<()> {
    // 公開用メタデータと対象環境、起動パスを検証する
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

    // 独立したファイルを並列処理しチャンクバッファを最大4個に制限する
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

    // チャンク情報を含むリリースを組み立てて署名と配信先を検証する
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

    // 同じバージョンの既存内容を上書きせず不変マニフェストを保存する
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

    // 表示アセットを内容ハッシュで保存して言語別カタログを更新する
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

    // 参照先の準備がすべて終わってから latest を更新する
    check_cancelled()?;
    files::write_json(&output.join(latest), &manifest)
}

/// 確認済みのお知らせに新しい生成日時を付けて公開する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `output` - 配信ファイルを配置するローカルディレクトリ
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
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

/// プラットフォーム別の Qt IFW リリース情報を公開する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `base_url` - 配信先の基準 URL
/// * `locale` - 公開する言語タグ
/// * `platform` - 対象 OS、windows・macos・linux のいずれか
/// * `arch` - 対象 CPU、x86_64 または arm64
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
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

/// 専用の入力から言語別の変更履歴を公開する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `locale` - 公開する言語タグ
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn changelog(source: &Path, output: &Path, locale: &str) -> Result<()> {
    contracts::locale(locale)?;
    let document = files::read_json(source)?;
    contracts::validate(&document, "launcher-changelog.schema.json")?;
    files::write_json(
        &output.join(format!("v1/launcher/changelog/{locale}.json")),
        &document,
    )
}
