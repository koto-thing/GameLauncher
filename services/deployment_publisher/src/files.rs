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

/// Read a JSON document with its source path in error diagnostics
pub fn read_json(path: &Path) -> Result<Value> {
    serde_json::from_reader(File::open(path)?)
        .with_context(|| format!("invalid JSON: {}", path.display()))
}

/// Atomically replace a JSON document using a temporary file on the same filesystem
pub fn write_json(path: &Path, document: &Value) -> Result<()> {
    let parent = path.parent().context("missing parent directory")?;
    fs::create_dir_all(parent)?;
    let mut bytes = serde_json::to_vec_pretty(document)?;
    bytes.push(b'\n');
    pandd_local_storage::write_atomic(path, &bytes)
}

/// Enumerate regular files deterministically and reject symlinks and Windows junctions
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

/// Convert a filesystem-relative name to a portable object key
pub fn object_key(path: &Path, root: &Path) -> Result<String> {
    Ok(path
        .strip_prefix(root)?
        .to_str()
        .context("non-UTF-8 file name")?
        .replace('\\', "/"))
}

/// Store immutable content without overwriting a conflicting existing object
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

/// Split one file into stable 64 MiB chunks while hashing the complete stream
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

/// Store a display asset under its content-addressed name
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

/// Set stable content types for public JSON and XML independent of host MIME tables
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
