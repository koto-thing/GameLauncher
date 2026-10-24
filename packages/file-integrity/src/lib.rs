use anyhow::{Context, Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

const BUFFER_SIZE: usize = 1024 * 1024;

#[derive(Debug)]
pub enum Failure {
    Integrity,
    Cancelled,
}

impl std::fmt::Display for Failure {
    /// Preserve a typed failure across application boundaries
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Integrity => "file size or SHA-256 mismatch",
            Self::Cancelled => "file operation cancelled",
        })
    }
}

impl std::error::Error for Failure {}

pub struct Part {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
}

pub struct FileDigest {
    pub size: u64,
    pub sha256: String,
}

/// Stop before reading or committing cancelled work
fn checkpoint(cancelled: &impl Fn() -> bool) -> Result<()> {
    ensure!(!cancelled(), Failure::Cancelled);
    Ok(())
}

/// Open regular files while rejecting leaf symlinks and Windows reparse points
fn open_file(path: &Path) -> Result<File> {
    let metadata = std::fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "not a regular file"
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            metadata.file_attributes() & 0x400 == 0,
            "reparse point is forbidden"
        );
    }
    File::open(path).with_context(|| format!("cannot open {}", path.display()))
}

/// Hash an in-memory block with the same algorithm used for streamed files
pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Hash a reader with bounded memory and cancellation at each block
pub fn hash_reader(mut reader: impl Read, cancelled: impl Fn() -> bool) -> Result<FileDigest> {
    let mut buffer = vec![0; BUFFER_SIZE];
    let mut digest = Sha256::new();
    let mut size = 0u64;
    loop {
        checkpoint(&cancelled)?;
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
        size = size
            .checked_add(count as u64)
            .context("file size overflow")?;
    }
    Ok(FileDigest {
        size,
        sha256: format!("{:x}", digest.finalize()),
    })
}

/// Hash one regular file in a single sequential pass
pub fn hash_file(path: &Path) -> Result<String> {
    Ok(hash_reader(open_file(path)?, || false)?.sha256)
}

/// Verify size and content from the same open file
pub fn verify_file(path: &Path, size: u64, digest: &str) -> Result<()> {
    let file = open_file(path)?;
    ensure!(file.metadata()?.len() == size, Failure::Integrity);
    let actual = hash_reader(file, || false)?;
    ensure!(
        actual.size == size && actual.sha256 == digest,
        Failure::Integrity
    );
    Ok(())
}

/// Copy exactly one part while hashing both the part and the assembled stream
fn transfer(
    reader: &mut impl Read,
    writer: &mut impl Write,
    size: u64,
    expected: &str,
    whole: &mut Sha256,
    buffer: &mut [u8],
    cancelled: &impl Fn() -> bool,
) -> Result<()> {
    let mut remaining = size;
    let mut digest = Sha256::new();
    while remaining > 0 {
        checkpoint(cancelled)?;
        let limit = remaining.min(buffer.len() as u64) as usize;
        let count = reader.read(&mut buffer[..limit])?;
        ensure!(count > 0, Failure::Integrity);
        let bytes = &buffer[..count];
        writer.write_all(bytes)?;
        digest.update(bytes);
        whole.update(bytes);
        remaining -= count as u64;
    }
    ensure!(
        format!("{:x}", digest.finalize()) == expected,
        Failure::Integrity
    );
    Ok(())
}

/// Commit only successfully verified bytes without rereading the temporary output
fn commit(
    temporary: NamedTempFile,
    destination: &Path,
    cancelled: &impl Fn() -> bool,
) -> Result<()> {
    checkpoint(cancelled)?;
    temporary.as_file().sync_all()?;
    checkpoint(cancelled)?;
    temporary.persist(destination)?;
    Ok(())
}

/// Assemble and authenticate all chunks in one pass before atomically replacing the destination
pub fn assemble(
    parts: &[Part],
    destination: &Path,
    size: u64,
    digest: &str,
    cancelled: impl Fn() -> bool,
) -> Result<()> {
    checkpoint(&cancelled)?;
    let sum = parts
        .iter()
        .try_fold(0u64, |sum, part| sum.checked_add(part.size))
        .context("chunk size overflow")?;
    ensure!(sum == size, Failure::Integrity);
    let mut temporary = NamedTempFile::new_in(destination.parent().context("missing parent")?)?;
    let mut whole = Sha256::new();
    let mut buffer = vec![0; BUFFER_SIZE];
    for part in parts {
        let mut source = open_file(&part.path)?;
        ensure!(source.metadata()?.len() == part.size, Failure::Integrity);
        transfer(
            &mut source,
            &mut temporary,
            part.size,
            &part.sha256,
            &mut whole,
            &mut buffer,
            &cancelled,
        )?;
        ensure!(source.read(&mut [0u8; 1])? == 0, Failure::Integrity);
    }
    ensure!(
        format!("{:x}", whole.finalize()) == digest,
        Failure::Integrity
    );
    commit(temporary, destination, &cancelled)
}

/// Verify and copy an existing file using the same transactional assembly path
pub fn copy_verified(
    source: &Path,
    destination: &Path,
    size: u64,
    digest: &str,
    cancelled: impl Fn() -> bool,
) -> Result<()> {
    assemble(
        &[Part {
            path: source.into(),
            size,
            sha256: digest.into(),
        }],
        destination,
        size,
        digest,
        cancelled,
    )
}

/// Recover a verified chunk from an installed file with one bounded read of its range
pub fn copy_range_verified(
    source: &Path,
    offset: u64,
    destination: &Path,
    size: u64,
    digest: &str,
    cancelled: impl Fn() -> bool,
) -> Result<()> {
    checkpoint(&cancelled)?;
    let mut input = open_file(source)?;
    let source_size = input.metadata()?.len();
    ensure!(
        offset
            .checked_add(size)
            .is_some_and(|end| end <= source_size),
        Failure::Integrity
    );
    input.seek(SeekFrom::Start(offset))?;
    let mut temporary = NamedTempFile::new_in(destination.parent().context("missing parent")?)?;
    transfer(
        &mut input,
        &mut temporary,
        size,
        digest,
        &mut Sha256::new(),
        &mut vec![0; BUFFER_SIZE],
        &cancelled,
    )?;
    commit(temporary, destination, &cancelled)
}

/// Split a source once and supply authenticated chunks to the publisher's storage callback
pub fn split_file(
    source: &Path,
    chunk_size: usize,
    cancelled: impl Fn() -> bool,
    mut store: impl FnMut(u64, &[u8], &str) -> Result<()>,
) -> Result<FileDigest> {
    ensure!(chunk_size > 0, "chunk size must be positive");
    let mut file = open_file(source)?;
    let expected_size = file.metadata()?.len();
    ensure!(expected_size > 0, "empty release files are not supported");
    let mut buffer = vec![0; expected_size.min(chunk_size as u64) as usize];
    let mut whole = Sha256::new();
    let mut offset = 0u64;
    let mut last_digest = String::new();
    loop {
        checkpoint(&cancelled)?;
        let mut count = 0;
        while count < buffer.len() {
            checkpoint(&cancelled)?;
            let end = buffer.len().min(count + BUFFER_SIZE);
            let read = file.read(&mut buffer[count..end])?;
            if read == 0 {
                break;
            }
            count += read;
        }
        if count == 0 {
            break;
        }
        let bytes = &buffer[..count];
        if expected_size > chunk_size as u64 {
            whole.update(bytes);
        }
        last_digest = hash_bytes(bytes);
        checkpoint(&cancelled)?;
        store(offset, bytes, &last_digest)?;
        offset = offset
            .checked_add(count as u64)
            .context("source size overflow")?;
    }
    ensure!(
        offset == expected_size,
        "source size changed during publication"
    );
    Ok(FileDigest {
        size: offset,
        sha256: if expected_size <= chunk_size as u64 {
            last_digest
        } else {
            format!("{:x}", whole.finalize())
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};

    struct CountedReader {
        input: Cursor<Vec<u8>>,
        bytes: usize,
    }

    impl Read for CountedReader {
        /// Count physical source bytes consumed by the transfer loop
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let count = self.input.read(buffer)?;
            self.bytes += count;
            Ok(count)
        }
    }

    struct FailingWriter;

    impl Write for FailingWriter {
        /// Simulate a destination write failure
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("disk full"))
        }

        /// No buffered bytes exist in this test writer
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// Prove both hashes and output are derived from a single traversal of source bytes
    #[test]
    fn transfer_reads_each_byte_once_and_propagates_io_failures() -> Result<()> {
        let content = vec![19u8; BUFFER_SIZE + 17];
        let digest = hash_bytes(&content);
        let mut reader = CountedReader {
            input: Cursor::new(content.clone()),
            bytes: 0,
        };
        let mut output = Vec::new();
        let mut whole = Sha256::new();
        let mut buffer = vec![0; BUFFER_SIZE];
        transfer(
            &mut reader,
            &mut output,
            content.len() as u64,
            &digest,
            &mut whole,
            &mut buffer,
            &|| false,
        )?;
        assert_eq!(reader.bytes, content.len());
        assert_eq!(output, content);
        assert_eq!(format!("{:x}", whole.finalize()), digest);
        assert!(
            transfer(
                &mut Cursor::new(&content),
                &mut FailingWriter,
                content.len() as u64,
                &digest,
                &mut Sha256::new(),
                &mut buffer,
                &|| false
            )
            .is_err()
        );
        assert!(
            transfer(
                &mut Cursor::new(b"short"),
                &mut Vec::new(),
                10,
                &digest,
                &mut Sha256::new(),
                &mut buffer,
                &|| false
            )
            .is_err()
        );
        Ok(())
    }
}
