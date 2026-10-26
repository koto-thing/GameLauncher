use crate::{MAX_ATTEMPTS, POLL_INTERVAL, retry_delay};
use anyhow::{Result, ensure};
use futures_util::{StreamExt, TryStreamExt, stream};
use pandd_local_storage::Root;
use sha2::{Digest, Sha256};
use std::{
    cell::{Cell, RefCell},
    fs::OpenOptions,
    future::Future,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    time::{Duration, Instant},
};

pub struct Chunk {
    pub url: String,
    pub digest: String,
    pub size: u64,
}

pub trait Control {
    /// ランタイムをブロックせずキャンセル要求を取得する
    ///
    /// # 戻り値
    ///
    /// キャンセルが要求されている場合は true
    fn cancelled(&self) -> bool;

    /// 共有の一時停止状態を取得する
    ///
    /// # 戻り値
    ///
    /// 一時停止が要求されている場合は true
    fn paused(&self) -> bool;

    /// キャッシュを含む取得済みバイト数と実際の通信速度を通知する
    ///
    /// # 引数
    ///
    /// * `received` - キャッシュ済みデータを含む取得済みバイト数
    /// * `bytes_per_second` - ネットワーク転送速度のバイト毎秒
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn progress(&self, received: u64, bytes_per_second: u64);
}

#[derive(Debug)]
pub enum Failure {
    Cancelled,
    Http { retryable: bool },
}

impl std::fmt::Display for Failure {
    /// アプリケーション境界で転送失敗の種別を保つ
    ///
    /// # 引数
    ///
    /// * `f` - エラーの出力先
    ///
    /// # 戻り値
    ///
    /// 整形結果の書込が成功した場合は Ok(())
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "download cancelled"),
            Self::Http { .. } => write!(f, "download failed"),
        }
    }
}
impl std::error::Error for Failure {}

/// リクエスト、再試行、速度制限の待機中もキャンセルを監視する
///
/// # 引数
///
/// * `future` - 一時停止とキャンセルを監視しながら待機する処理
/// * `control` - 一時停止やキャンセルの状態と進捗通知先
///
/// # 戻り値
///
/// 完了時は `Ok(T)`、キャンセル時は `Err(Failure::Cancelled)`
/// 待機対象自身のエラーは `T` の一部としてそのまま返す
async fn controlled<T>(future: impl Future<Output = T>, control: &impl Control) -> Result<T> {
    // 待機対象を保持し、短い間隔で操作要求を確認する
    tokio::pin!(future);

    loop {
        ensure!(!control.cancelled(), Failure::Cancelled);
        if control.paused() {
            tokio::time::sleep(POLL_INTERVAL).await;
            continue;
        }

        // 一時停止が解除されている間だけ待機対象を進める
        tokio::select! {
            result = &mut future => return Ok(result),
            _ = tokio::time::sleep(POLL_INTERVAL) => {}
        }
    }
}

struct Session<'a, C> {
    control: &'a C,
    client: reqwest::Client,
    root: Root,
    started: Instant,
    next_byte: Cell<Instant>,
    speed_limit: u64,
    network_bytes: Cell<u64>,
    positions: RefCell<Vec<u64>>,
    cached: u64,
}

impl<C: Control> Session<'_, C> {
    /// 待機中の余剰枠を持ち越さず全並列リクエストで転送量の枠を共有する
    ///
    /// # 引数
    ///
    /// * `bytes` - 今回受信したネットワークのバイト数
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    async fn throttle(&self, bytes: usize) -> Result<()> {
        // 通信済みバイト数は速度制限の有無にかかわらず集計する
        self.network_bytes
            .set(self.network_bytes.get().saturating_add(bytes as u64));

        // 全チャンクで次の受信可能時刻を共有して通信量を制限する
        if self.speed_limit != 0 {
            let start = self.next_byte.get().max(Instant::now());
            let deadline = start + Duration::from_secs_f64(bytes as f64 / self.speed_limit as f64);
            self.next_byte.set(deadline);
            controlled(tokio::time::sleep_until(deadline.into()), self.control).await?;
        }
        Ok(())
    }

    /// 再試行で進捗が重複加算されないようチャンクごとの位置を管理する
    ///
    /// # 引数
    ///
    /// * `index` - 進捗を管理するチャンクの位置
    /// * `position` - 当該チャンクの取得済みバイト数
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn report(&self, index: usize, position: u64) {
        // 再試行時も現在位置で置き換え、キャッシュ分と合算する
        self.positions.borrow_mut()[index] = position;
        let received = self
            .positions
            .borrow()
            .iter()
            .fold(self.cached, |sum, value| sum.saturating_add(*value));

        // 速度はキャッシュ分を除いた実際の通信量から求める
        let speed = (self.network_bytes.get() as f64
            / self.started.elapsed().as_secs_f64().max(0.001)) as u64;
        self.control.progress(received, speed);
    }

    /// 不変チャンクの途中取得を再開し回復可能な失敗だけを再試行する
    ///
    /// # 引数
    ///
    /// * `index` - 進捗を管理するチャンクの位置
    /// * `chunk` - 取得するチャンクの URL、サイズ、ハッシュ
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    async fn chunk(&self, index: usize, chunk: &Chunk) -> Result<()> {
        // キャッシュ名と接続先を検証してからネットワーク処理を始める
        ensure!(
            chunk.digest.len() == 64 && chunk.digest.bytes().all(|b| b.is_ascii_hexdigit()),
            "invalid cache digest"
        );
        let url = reqwest::Url::parse(&chunk.url)?;
        ensure!(
            url.scheme() == "https"
                || (url.scheme() == "http"
                    && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))),
            "unsafe download URL"
        );

        // 回復可能なエラーだけを上限回数まで再試行する
        let mut last = String::new();
        for attempt in 0..MAX_ATTEMPTS {
            controlled(std::future::ready(()), self.control).await?;
            match self.attempt(index, chunk).await {
                Ok(()) => return Ok(()),
                Err(error) => {
                    match error.downcast_ref::<Failure>() {
                        Some(Failure::Cancelled | Failure::Http { retryable: false }) => {
                            return Err(error);
                        }
                        Some(Failure::Http { retryable: true }) => {}
                        None if error.downcast_ref::<reqwest::Error>().is_some() => {}
                        None => return Err(error),
                    }
                    last = format!("{error:#}");
                }
            }

            // 最終試行の後は待機せず、最後の失敗を呼出元へ返す
            if attempt + 1 < MAX_ATTEMPTS {
                controlled(tokio::time::sleep(retry_delay(attempt)), self.control).await?;
            }
        }
        Err(anyhow::Error::new(Failure::Http { retryable: true }).context(last))
    }

    /// 再開位置までを一度だけハッシュ化し受信データは書込と同時にハッシュ化する
    ///
    /// # 引数
    ///
    /// * `index` - 進捗を管理するチャンクの位置
    /// * `chunk` - 取得するチャンクの URL、サイズ、ハッシュ
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    async fn attempt(&self, index: usize, chunk: &Chunk) -> Result<()> {
        // 途中ファイルを開き宣言サイズ以上なら取得をやり直す
        let path = self.root.path(Path::new(&chunk.digest))?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)?;
        let mut position = file.metadata()?.len();
        if position >= chunk.size {
            file.set_len(0)?;
            position = 0;
        }

        // 保存済みの先頭部分を一度読み込んでハッシュ状態を復元する
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            controlled(std::future::ready(()), self.control).await?;
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        self.report(index, position);

        // 途中取得がある場合は Range を指定して残りを要求する
        let mut request = self
            .client
            .get(&chunk.url)
            .header("Accept-Encoding", "identity");
        if position > 0 {
            request = request.header("Range", format!("bytes={position}-"));
        }
        let mut response = controlled(request.send(), self.control).await??;
        let status = response.status().as_u16();
        if status != 200 && status != 206 {
            let retryable = status == 408 || status == 429 || status >= 500;
            return Err(
                anyhow::Error::new(Failure::Http { retryable }).context(format!("HTTP {status}"))
            );
        }
        if status == 200 && position > 0 {
            // 全体応答は既存の先頭部分へ追記せず置き換える
            file.set_len(0)?;
            file.seek(SeekFrom::Start(0))?;
            position = 0;
            hasher = Sha256::new();
            self.report(index, 0);
        }

        // 部分応答が要求範囲と一致し透過的な圧縮がないことを確認する
        if status == 206 {
            let expected = format!(
                "bytes {}-{}/{}",
                position,
                chunk.size.saturating_sub(1),
                chunk.size
            );
            ensure!(
                response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    == Some(expected.as_str()),
                Failure::Http { retryable: false }
            );
        }
        ensure!(
            response
                .headers()
                .get("content-encoding")
                .is_none_or(|v| v == "identity"),
            Failure::Http { retryable: false }
        );
        if response
            .content_length()
            .is_some_and(|length| length > chunk.size - position)
        {
            file.set_len(0)?;
            return Err(Failure::Http { retryable: false }.into());
        }

        // サイズ上限と共有の速度制限を守りながら受信内容を書き込む
        while let Some(bytes) = controlled(response.chunk(), self.control).await?? {
            if bytes.len() as u64 > chunk.size - position {
                file.set_len(0)?;
                return Err(Failure::Http { retryable: false }.into());
            }

            // 書込を小さく区切り低速時の応答性とメモリ使用量を保つ
            for block in bytes.chunks(64 * 1024) {
                self.throttle(block.len()).await?;
                controlled(std::future::ready(()), self.control).await?;
                file.write_all(block)?;
                hasher.update(block);
                position += block.len() as u64;
                self.report(index, position);
            }
        }

        // サイズかハッシュが不一致なら破棄し一致した場合だけ同期する
        if position != chunk.size || format!("{:x}", hasher.finalize()) != chunk.digest {
            file.set_len(0)?;
            self.report(index, 0);
            return Err(Failure::Http { retryable: true }.into());
        }
        file.sync_all()?;
        Ok(())
    }
}

/// 呼出元のワーカースレッドで並列数を制限したダウンロードを実行する
///
/// # 引数
///
/// * `chunks` - 取得するチャンクの一覧
/// * `root` - 操作の基準となる管理ルート
/// * `cached` - 開始時点で検証済みのキャッシュのバイト数
/// * `speed_limit` - 全チャンクで共有するバイト毎秒の上限、0は無制限
/// * `control` - 一時停止やキャンセルの状態と進捗通知先
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn download(
    chunks: &[Chunk],
    root: &Path,
    cached: u64,
    speed_limit: u64,
    control: &impl Control,
) -> Result<()> {
    // UI の通知先スレッドを維持する単一スレッドのランタイムを用意する
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let session = Session {
            control,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .connect_timeout(Duration::from_secs(30))
                .read_timeout(Duration::from_secs(30))
                .no_gzip()
                .no_brotli()
                .no_deflate()
                .no_zstd()
                .build()?,
            root: Root::new(root)?,
            started: Instant::now(),
            next_byte: Cell::new(Instant::now()),
            speed_limit,
            network_bytes: Cell::new(0),
            positions: RefCell::new(vec![0; chunks.len()]),
            cached,
        };

        // 最大3チャンクを並列に取得し全体で一つの速度上限を共有する
        stream::iter(
            chunks
                .iter()
                .enumerate()
                .map(|(index, chunk)| session.chunk(index, chunk)),
        )
        .buffer_unordered(3)
        .try_collect::<Vec<_>>()
        .await?;
        Ok(())
    })
}
