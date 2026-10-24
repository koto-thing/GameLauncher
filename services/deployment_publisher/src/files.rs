use crate::CANCELLED;
use anyhow::{Context, Result, ensure};
use pandd_distribution_contracts::CHUNK_SIZE;
use pandd_file_integrity::{hash_bytes, split_file};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

/// JSON を読み込みエラーに入力元のパスを付与する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 読み込んだ JSON 文書
pub fn read_json(path: &Path) -> Result<Value> {
    serde_json::from_reader(File::open(path)?)
        .with_context(|| format!("invalid JSON: {}", path.display()))
}

/// 同じファイルシステムの一時ファイルで JSON を原子的に置き換える
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `document` - 検証または保存する JSON 文書
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn write_json(path: &Path, document: &Value) -> Result<()> {
    let parent = path.parent().context("missing parent directory")?;
    fs::create_dir_all(parent)?;
    let mut bytes = serde_json::to_vec_pretty(document)?;
    bytes.push(b'\n');
    pandd_local_storage::write_atomic(path, &bytes)
}

/// リンクや Windows のジャンクションを拒否し通常ファイルを一定の順序で列挙する
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
///
/// # 戻り値
///
/// パス順に並べた通常ファイルの一覧
pub fn regular_files(root: &Path) -> Result<Vec<PathBuf>> {
    ensure!(root.is_dir(), "not a directory: {}", root.display());
    let mut files = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "links are forbidden: {}",
            entry.path().display()
        );

        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                metadata.file_attributes() & 0x400 == 0,
                "reparse points are forbidden: {}",
                entry.path().display()
            );
        }

        ensure!(
            metadata.is_file() || metadata.is_dir(),
            "special files are forbidden"
        );
        if metadata.is_file() {
            files.push(entry.into_path());
        }
    }
    files.sort();
    Ok(files)
}

/// 相対ファイル名を環境に依存しないオブジェクトキーに変換する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `root` - 操作の基準となる管理ルート
///
/// # 戻り値
///
/// 区切り文字をスラッシュに統一した相対キー
pub fn object_key(path: &Path, root: &Path) -> Result<String> {
    Ok(path
        .strip_prefix(root)?
        .to_str()
        .context("non-UTF-8 file name")?
        .replace('\\', "/"))
}

/// 既存内容との不一致を拒否して不変オブジェクトを保存する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `bytes` - 処理対象のバイト列
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn store_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("missing parent directory")?;
    fs::create_dir_all(parent)?;
    if path.exists() {
        ensure!(
            fs::read(path)? == bytes,
            "immutable content mismatch: {}",
            path.display()
        );
        return Ok(());
    }

    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    match temporary.persist_noclobber(path) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            ensure!(
                fs::read(path)? == bytes,
                "immutable content mismatch: {}",
                path.display()
            );
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

/// ファイル全体をハッシュ化しながら64 MiB のチャンクに分割する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `base_url` - 配信先の基準 URL
///
/// # 戻り値
///
/// ファイルのサイズ、SHA-256、チャンク一覧を含む JSON
pub fn chunk_file(source: &Path, output: &Path, base_url: &str) -> Result<Value> {
    let mut chunks = Vec::new();
    let result = split_file(
        source,
        CHUNK_SIZE,
        || CANCELLED.load(Ordering::Relaxed),
        |offset, bytes, digest| {
            let relative = format!("v1/blobs/sha256/{digest}");
            store_bytes(&output.join(&relative), bytes)?;
            chunks.push(
                json!({"offset": offset, "size": bytes.len(), "sha256": digest,
            "url": format!("{}/{relative}", base_url.trim_end_matches('/'))}),
            );
            Ok(())
        },
    )?;
    Ok(json!({"size": result.size, "sha256": result.sha256, "chunks": chunks}))
}

/// 表示アセットを内容ハッシュに基づく名前で保存する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `base_url` - 配信先の基準 URL
///
/// # 戻り値
///
/// 内容ハッシュを含む公開アセットの URL
pub fn copy_asset(source: &Path, output: &Path, base_url: &str) -> Result<String> {
    let content = fs::read(source)?;
    let digest = hash_bytes(&content);
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin")
        .to_lowercase();
    let relative = format!("v1/assets/sha256/{digest}.{extension}");
    store_bytes(&output.join(&relative), &content)?;
    Ok(format!("{}/{relative}", base_url.trim_end_matches('/')))
}

/// ホストの MIME 設定に依存せず公開 JSON と XML の Content-Type を決める
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 公開ファイルに使用する Content-Type
pub fn content_type(path: &Path) -> String {
    match path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "json" => "application/json; charset=utf-8".into(),
        "xml" => "application/xml; charset=utf-8".into(),
        _ => mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string(),
    }
}
