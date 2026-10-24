use anyhow::Result;
use pandd_file_integrity::{self as integrity, Failure, Part};
use std::{cell::Cell, fs};
use tempfile::tempdir;

/// Check a published SHA-256 vector and strict size verification
#[test]
fn hashes_and_verifies_known_bytes() -> Result<()> {
    let root = tempdir()?;
    let path = root.path().join("日本語.bin");
    fs::write(&path, b"abc")?;
    let digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert_eq!(integrity::hash_file(&path)?, digest);
    integrity::verify_file(&path, 3, digest)?;
    assert!(integrity::verify_file(&path, 2, digest).is_err());
    assert!(integrity::verify_file(&path, 3, &"0".repeat(64)).is_err());
    assert!(integrity::verify_file(root.path(), 3, digest).is_err());
    Ok(())
}

/// Exercise Publisher splitting and Launcher assembly with partial and exact final chunks
#[test]
fn publisher_chunks_round_trip_through_verified_assembly() -> Result<()> {
    for size in [1, 17, 64, 65, 1024 * 1024 + 31] {
        let root = tempdir()?;
        let source = root.path().join("source");
        let content: Vec<u8> = (0..size).map(|index| (index % 251) as u8).collect();
        fs::write(&source, &content)?;
        let mut parts = Vec::new();
        let summary = integrity::split_file(
            &source,
            64 * 1024,
            || false,
            |offset, bytes, digest| {
                assert_eq!(
                    offset,
                    parts.iter().map(|part: &Part| part.size).sum::<u64>()
                );
                let path = root.path().join(format!("chunk-{offset}"));
                fs::write(&path, bytes)?;
                parts.push(Part {
                    path,
                    size: bytes.len() as u64,
                    sha256: digest.into(),
                });
                Ok(())
            },
        )?;
        let output = root.path().join("結合.bin");
        integrity::assemble(&parts, &output, summary.size, &summary.sha256, || false)?;
        assert_eq!(fs::read(output)?, content);
        assert_eq!(summary.sha256, integrity::hash_bytes(&content));
    }
    Ok(())
}

/// Leave the prior destination untouched on every integrity failure and clean temporary files
#[test]
fn failed_assembly_never_replaces_the_destination() -> Result<()> {
    let root = tempdir()?;
    let source = root.path().join("chunk");
    let output = root.path().join("output");
    fs::write(&source, b"abc")?;
    fs::write(&output, b"old release")?;
    for (size, chunk_digest, whole_digest) in [
        (
            3,
            integrity::hash_bytes(b"xyz"),
            integrity::hash_bytes(b"abc"),
        ),
        (
            3,
            integrity::hash_bytes(b"abc"),
            integrity::hash_bytes(b"xyz"),
        ),
        (
            2,
            integrity::hash_bytes(b"ab"),
            integrity::hash_bytes(b"ab"),
        ),
        (
            4,
            integrity::hash_bytes(b"abcd"),
            integrity::hash_bytes(b"abcd"),
        ),
    ] {
        let parts = [Part {
            path: source.clone(),
            size,
            sha256: chunk_digest,
        }];
        assert!(integrity::assemble(&parts, &output, size, &whole_digest, || false).is_err());
        assert_eq!(fs::read(&output)?, b"old release");
        assert_eq!(fs::read_dir(root.path())?.count(), 2);
    }
    Ok(())
}

/// Abort after some bytes have been written and before final commit without leaking staging data
#[test]
fn cancelled_copy_cleans_temporary_output() -> Result<()> {
    let root = tempdir()?;
    let source = root.path().join("source");
    let output = root.path().join("output");
    let content = vec![7u8; 3 * 1024 * 1024];
    fs::write(&source, &content)?;
    fs::write(&output, b"old")?;
    for stop_after in [3, 5, 6] {
        let calls = Cell::new(0);
        let error = integrity::copy_verified(
            &source,
            &output,
            content.len() as u64,
            &integrity::hash_bytes(&content),
            || {
                calls.set(calls.get() + 1);
                calls.get() >= stop_after
            },
        )
        .unwrap_err();
        assert!(matches!(
            error.downcast_ref::<Failure>(),
            Some(Failure::Cancelled)
        ));
        assert_eq!(fs::read(&output)?, b"old");
        assert_eq!(fs::read_dir(root.path())?.count(), 2);
    }
    Ok(())
}

/// Verify range boundaries and reject out-of-bounds recovery before committing the cache
#[test]
fn recovers_only_the_requested_verified_range() -> Result<()> {
    let root = tempdir()?;
    let source = root.path().join("source");
    let output = root.path().join("cache");
    fs::write(&source, b"prefix-chunk-suffix")?;
    let digest = integrity::hash_bytes(b"chunk");
    integrity::copy_range_verified(&source, 7, &output, 5, &digest, || false)?;
    assert_eq!(fs::read(&output)?, b"chunk");
    assert!(
        integrity::copy_range_verified(&source, u64::MAX, &output, 5, &digest, || false).is_err()
    );
    assert!(integrity::copy_range_verified(&source, 0, &output, 5, &digest, || false).is_err());
    assert_eq!(fs::read(&output)?, b"chunk");
    Ok(())
}

/// Propagate storage callback failures and reject invalid Publisher inputs
#[test]
fn publisher_rejects_empty_sources_and_storage_failures() -> Result<()> {
    let root = tempdir()?;
    let source = root.path().join("source");
    fs::write(&source, b"")?;
    assert!(integrity::split_file(&source, 16, || false, |_, _, _| Ok(())).is_err());
    fs::write(&source, b"abc")?;
    assert!(integrity::split_file(&source, 0, || false, |_, _, _| Ok(())).is_err());
    assert!(
        integrity::split_file(&source, 16, || false, |_, _, _| anyhow::bail!("disk full")).is_err()
    );
    Ok(())
}
