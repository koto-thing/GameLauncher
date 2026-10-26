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
    /// ファイル処理の失敗種別を境界を越えて伝える
    ///
    /// # 引数
    ///
    /// * `formatter` - エラーの出力先
    ///
    /// # 戻り値
    ///
    /// 整形結果の書込が成功した場合は Ok(())
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

/// キャンセルされた処理を読込や確定の前に停止する
///
/// # 引数
///
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn checkpoint(cancelled: &impl Fn() -> bool) -> Result<()> {
    ensure!(!cancelled(), Failure::Cancelled);
    Ok(())
}

/// 末尾のシンボリックリンクや Windows の再解析ポイントを拒否して通常ファイルを開く
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 読込用に開いた通常ファイル
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

/// ファイル読込と同じ SHA-256 でメモリ上のバイト列をハッシュ化する
///
/// # 引数
///
/// * `bytes` - 処理対象のバイト列
///
/// # 戻り値
///
/// SHA-256 の小文字16進文字列
pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// メモリ使用量を制限し、各ブロックでキャンセルを確認しながらハッシュ化する
///
/// # 引数
///
/// * `reader` - データの読込元
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 読込バイト数とファイル全体の SHA-256
pub fn hash_reader(mut reader: impl Read, cancelled: impl Fn() -> bool) -> Result<FileDigest> {
    // 固定サイズのバッファで読込とハッシュ計算を進める
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

/// 通常ファイルを一度だけ順番に読み込んでハッシュ化する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// ファイル全体の SHA-256 の小文字16進文字列
pub fn hash_file(path: &Path) -> Result<String> {
    Ok(hash_reader(open_file(path)?, || false)?.sha256)
}

/// 同じファイルハンドルでサイズと内容を検証する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
///
/// # 戻り値
///
/// サイズと SHA-256 が一致した場合は Ok(())
pub fn verify_file(path: &Path, size: u64, digest: &str) -> Result<()> {
    // サイズが異なる場合は内容を読み込まずに失敗する
    let file = open_file(path)?;
    ensure!(file.metadata()?.len() == size, Failure::Integrity);

    // 読込後にもサイズを照合し、処理中の変更を検出する
    let actual = hash_reader(file, || false)?;
    ensure!(
        actual.size == size && actual.sha256 == digest,
        Failure::Integrity
    );
    Ok(())
}

/// チャンクと結合全体のハッシュを更新しながら指定サイズをコピーする
///
/// # 引数
///
/// * `reader` - データの読込元
/// * `writer` - データの書込先
/// * `size` - 期待するバイト数
/// * `expected` - 期待するチャンクの SHA-256
/// * `whole` - 結合するファイル全体のハッシュ状態
/// * `buffer` - 読込に再利用するバッファ
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn transfer(
    reader: &mut impl Read,
    writer: &mut impl Write,
    size: u64,
    expected: &str,
    whole: &mut Sha256,
    buffer: &mut [u8],
    cancelled: &impl Fn() -> bool,
) -> Result<()> {
    // 指定サイズまでコピーし、チャンクと全体のハッシュを同時に更新する
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

    // チャンクの検証失敗を呼出元へ返し、一時出力の確定を防ぐ
    ensure!(
        format!("{:x}", digest.finalize()) == expected,
        Failure::Integrity
    );
    Ok(())
}

/// 一時出力を再読込せず検証済みのバイト列だけを確定する
///
/// # 引数
///
/// * `temporary` - 保存先と同じファイルシステム上の一時ファイル
/// * `destination` - 書込先のパス
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn commit(
    temporary: NamedTempFile,
    destination: &Path,
    cancelled: &impl Fn() -> bool,
) -> Result<()> {
    checkpoint(cancelled)?;
    temporary.as_file().sync_all()?;

    // 同期中のキャンセルも確認してから保存先へ置き換える
    checkpoint(cancelled)?;
    temporary.persist(destination)?;
    Ok(())
}

/// 全チャンクを一度の読込で結合と検証を行い保存先を原子的に置き換える
///
/// # 引数
///
/// * `parts` - 結合順に並んだ検証対象チャンク
/// * `destination` - 書込先のパス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn assemble(
    parts: &[Part],
    destination: &Path,
    size: u64,
    digest: &str,
    cancelled: impl Fn() -> bool,
) -> Result<()> {
    // チャンクの総サイズを確認して不正な結合を拒否する
    checkpoint(&cancelled)?;
    let sum = parts
        .iter()
        .try_fold(0u64, |sum, part| sum.checked_add(part.size))
        .context("chunk size overflow")?;
    ensure!(sum == size, Failure::Integrity);

    // 各チャンクと全体のハッシュを同じ読込で更新して一時ファイルへ書き込む
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

    // 全体のハッシュが一致した場合にだけ出力先へ確定する
    ensure!(
        format!("{:x}", whole.finalize()) == digest,
        Failure::Integrity
    );
    commit(temporary, destination, &cancelled)
}

/// 検証付き結合と同じ仕組みで既存ファイルをコピーする
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `destination` - 書込先のパス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
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

/// インストール済みファイルの指定範囲を一度だけ読み込んでチャンクを復元する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `offset` - 読込元の先頭からのバイト位置
/// * `destination` - 書込先のパス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
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

    // 指定範囲だけを検証付きでコピーして確定する
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

/// 入力を一度だけ分割し検証用ハッシュとともに保存処理へ渡す
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `chunk_size` - 分割するチャンクの最大バイト数
/// * `cancelled` - キャンセル要求がある場合に true を返す関数
/// * `store` - チャンクを保存するコールバック
///
/// # 戻り値
///
/// 分割した全バイト数とファイル全体の SHA-256
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

    // 一度の読込でチャンク保存と全体のハッシュ計算を進める
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

    // 分割中に入力のサイズが変わっていないことを確認する
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
        /// 転送ループが実際に読み込んだバイト数を数える
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let count = self.input.read(buffer)?;
            self.bytes += count;
            Ok(count)
        }
    }

    struct FailingWriter;

    impl Write for FailingWriter {
        /// 書込先の障害を再現する
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("disk full"))
        }

        /// テスト用の書込先には未出力のバッファがないため何もしない
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// 一度の読込からチャンクと全体のハッシュおよび出力が得られることを検証する
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
