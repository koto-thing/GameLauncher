mod installation;

use anyhow::Result;
use pandd_distribution_contracts::{crypto, manifest, schema};

#[cxx::bridge(namespace = "pandd::manifest_bridge")]
mod ffi {
    struct FileChunk {
        offset: u64,
        size: u64,
        sha256: String,
        url: String,
    }

    struct GameFile {
        path: String,
        size: u64,
        sha256: String,
        executable: bool,
        chunks: Vec<FileChunk>,
    }

    struct GameRelease {
        schema_version: u32,
        game_id: String,
        version: String,
        platform: String,
        arch: String,
        minimum_launcher_version: String,
        engine: String,
        entrypoint: String,
        working_directory: String,
        arguments: Vec<String>,
        save_directory_name: String,
        total_size: u64,
        files: Vec<GameFile>,
        published_at: String,
        signature: String,
    }

    struct DownloadChunk {
        url: String,
        digest: String,
        size: u64,
    }

    struct LocalPart {
        path: String,
        size: u64,
        sha256: String,
    }

    struct IoStatus {
        code: u8,
        detail: String,
    }

    unsafe extern "C++" {
        include!("DownloadControl.h");
        type DownloadControl;
        fn cancelled(self: &DownloadControl) -> bool;
        fn paused(self: &DownloadControl) -> bool;
        fn progress(self: &DownloadControl, received: u64, speed: u64);
        include!("FileIoControl.h");
        type FileIoControl;
        fn cancelled(self: &FileIoControl) -> bool;
    }

    extern "Rust" {
        fn download_chunks(
            chunks: &[DownloadChunk],
            root: &str,
            cached: u64,
            speed_limit: u64,
            control: &DownloadControl,
        ) -> IoStatus;
        fn activate_install(
            root: &str,
            game_id: &str,
            version: &str,
            entrypoint: &str,
            imported: bool,
        ) -> IoStatus;
        fn cleanup_install(root: &str, game_id: &str) -> IoStatus;
        fn discard_install(root: &str, game_id: &str, version: &str, imported: bool) -> IoStatus;

        fn verify_file(path: &str, size: u64, digest: &str) -> bool;
        fn assemble_files(
            parts: &[LocalPart],
            destination: &str,
            size: u64,
            digest: &str,
            control: &FileIoControl,
        ) -> IoStatus;
        fn copy_verified_file(
            source: &str,
            destination: &str,
            size: u64,
            digest: &str,
            control: &FileIoControl,
        ) -> IoStatus;
        fn recover_chunk(
            source: &str,
            offset: u64,
            destination: &str,
            size: u64,
            digest: &str,
            control: &FileIoControl,
        ) -> IoStatus;

        fn validate_manifest(bytes: &[u8], allowed_hosts: &[String]) -> Result<()>;
        fn verify_manifest(
            bytes: &[u8],
            public_key: &str,
            allowed_hosts: &[String],
        ) -> Result<GameRelease>;
        fn validate_public_key(public_key: &str) -> Result<()>;
        fn verify_signature(payload: &[u8], signature: &str, public_key: &str) -> bool;
        fn safe_relative_path(path: &str) -> bool;
    }
}

/// Validate JSON and deployment hosts without claiming cryptographic authenticity
fn validate_manifest(bytes: &[u8], allowed_hosts: &[String]) -> Result<()> {
    manifest::validate_hosts(&manifest::parse(bytes)?, allowed_hosts)
}

/// Transfer only an authenticated and validated Rust release across the CXX boundary
fn verify_manifest(
    bytes: &[u8],
    public_key: &str,
    allowed_hosts: &[String],
) -> Result<ffi::GameRelease> {
    let release = manifest::verify(bytes, public_key, allowed_hosts)?;
    Ok(ffi::GameRelease {
        schema_version: release.schema_version,
        game_id: release.game_id,
        version: release.version,
        platform: release.platform,
        arch: release.arch,
        minimum_launcher_version: release.minimum_launcher_version,
        engine: release.engine,
        entrypoint: release.entrypoint,
        working_directory: release.working_directory,
        arguments: release.arguments,
        save_directory_name: release.save_directory_name,
        total_size: release.total_size,
        files: release
            .files
            .into_iter()
            .map(|file| ffi::GameFile {
                path: file.path,
                size: file.size,
                sha256: file.sha256,
                executable: file.executable,
                chunks: file
                    .chunks
                    .into_iter()
                    .map(|chunk| ffi::FileChunk {
                        offset: chunk.offset,
                        size: chunk.size,
                        sha256: chunk.sha256,
                        url: chunk.url,
                    })
                    .collect(),
            })
            .collect(),
        published_at: release.published_at,
        signature: release.signature,
    })
}

/// Reject malformed pinned keys during repository construction
fn validate_public_key(public_key: &str) -> Result<()> {
    crypto::public_key(public_key).map(|_| ())
}

/// Verify detached signatures for physical edition profiles using the same cryptography
fn verify_signature(payload: &[u8], signature: &str, public_key: &str) -> bool {
    crypto::verify(payload, signature, public_key).is_ok()
}

/// Apply the shared relative-path rule to other launcher inputs
fn safe_relative_path(path: &str) -> bool {
    schema::relative_path(path).is_ok()
}

/// Preserve integrity, cancellation, and I/O error categories for the C++ application
fn io_status(result: anyhow::Result<()>) -> ffi::IoStatus {
    match result {
        Ok(()) => ffi::IoStatus {
            code: 0,
            detail: String::new(),
        },
        Err(error) => ffi::IoStatus {
            code: match error.downcast_ref::<pandd_file_integrity::Failure>() {
                Some(pandd_file_integrity::Failure::Integrity) => 1,
                Some(pandd_file_integrity::Failure::Cancelled) => 2,
                None => 3,
            },
            detail: format!("{error:#}"),
        },
    }
}

/// Validate an on-disk file without crossing the bridge for each read block
fn verify_file(path: &str, size: u64, digest: &str) -> bool {
    pandd_file_integrity::verify_file(path.as_ref(), size, digest).is_ok()
}

/// Assemble authenticated chunks and commit only after the whole digest matches
fn assemble_files(
    parts: &[ffi::LocalPart],
    destination: &str,
    size: u64,
    digest: &str,
    control: &ffi::FileIoControl,
) -> ffi::IoStatus {
    let parts: Vec<_> = parts
        .iter()
        .map(|part| pandd_file_integrity::Part {
            path: part.path.as_str().into(),
            size: part.size,
            sha256: part.sha256.clone(),
        })
        .collect();
    io_status(pandd_file_integrity::assemble(
        &parts,
        destination.as_ref(),
        size,
        digest,
        || control.cancelled(),
    ))
}

/// Copy a verified existing file without separate source and destination hash passes
fn copy_verified_file(
    source: &str,
    destination: &str,
    size: u64,
    digest: &str,
    control: &ffi::FileIoControl,
) -> ffi::IoStatus {
    io_status(pandd_file_integrity::copy_verified(
        source.as_ref(),
        destination.as_ref(),
        size,
        digest,
        || control.cancelled(),
    ))
}

/// Restore a cached chunk by validating bytes during the copy
fn recover_chunk(
    source: &str,
    offset: u64,
    destination: &str,
    size: u64,
    digest: &str,
    control: &ffi::FileIoControl,
) -> ffi::IoStatus {
    io_status(pandd_file_integrity::copy_range_verified(
        source.as_ref(),
        offset,
        destination.as_ref(),
        size,
        digest,
        || control.cancelled(),
    ))
}

/// Commit an installation while keeping post-commit cleanup warnings distinguishable
fn activate_install(
    root: &str,
    game_id: &str,
    version: &str,
    entrypoint: &str,
    imported: bool,
) -> ffi::IoStatus {
    match installation::activate(root.as_ref(), game_id, version, entrypoint, imported) {
        Ok(detail) => ffi::IoStatus { code: 0, detail },
        Err(error) => io_status(Err(error)),
    }
}

/// Remove only the temporary trees belonging to an identified installed game
fn cleanup_install(root: &str, game_id: &str) -> ffi::IoStatus {
    io_status(installation::cleanup(root.as_ref(), game_id))
}

/// Remove one failed staging tree under the same guarded filesystem boundary
fn discard_install(root: &str, game_id: &str, version: &str, imported: bool) -> ffi::IoStatus {
    io_status(installation::discard(
        root.as_ref(),
        game_id,
        version,
        imported,
    ))
}

impl pandd_transfer::download::Control for ffi::DownloadControl {
    /// Forward the atomic cancellation flag
    fn cancelled(&self) -> bool {
        self.cancelled()
    }
    /// Forward the atomic pause flag
    fn paused(&self) -> bool {
        self.paused()
    }
    /// Keep callbacks on the original calling thread
    fn progress(&self, received: u64, speed: u64) {
        self.progress(received, speed);
    }
}

/// Download a batch without moving UI callbacks or filesystem policy into C++
fn download_chunks(
    chunks: &[ffi::DownloadChunk],
    root: &str,
    cached: u64,
    speed_limit: u64,
    control: &ffi::DownloadControl,
) -> ffi::IoStatus {
    let chunks: Vec<_> = chunks
        .iter()
        .map(|chunk| pandd_transfer::download::Chunk {
            url: chunk.url.clone(),
            digest: chunk.digest.clone(),
            size: chunk.size,
        })
        .collect();
    match pandd_transfer::download::download(&chunks, root.as_ref(), cached, speed_limit, control) {
        Ok(()) => ffi::IoStatus {
            code: 0,
            detail: String::new(),
        },
        Err(error) => ffi::IoStatus {
            code: match error.downcast_ref::<pandd_transfer::download::Failure>() {
                Some(pandd_transfer::download::Failure::Cancelled) => 2,
                Some(pandd_transfer::download::Failure::Http { retryable: true }) => 4,
                Some(pandd_transfer::download::Failure::Http { retryable: false }) => 5,
                None => 3,
            },
            detail: format!("{error:#}"),
        },
    }
}
