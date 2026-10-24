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
    /// Read cancellation without blocking the runtime
    fn cancelled(&self) -> bool;
    /// Read the shared pause state
    fn paused(&self) -> bool;
    /// Report aggregate cached bytes and actual network throughput
    fn progress(&self, received: u64, bytes_per_second: u64);
}

#[derive(Debug)]
pub enum Failure {
    Cancelled,
    Http { retryable: bool },
}

impl std::fmt::Display for Failure {
    /// Preserve transfer failure categories at the application boundary
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "download cancelled"),
            Self::Http { .. } => write!(f, "download failed"),
        }
    }
}
impl std::error::Error for Failure {}

/// Poll cancellation even while a request, retry delay, or throttle is pending
async fn controlled<T>(future: impl Future<Output = T>, control: &impl Control) -> Result<T> {
    tokio::pin!(future);
    loop {
        ensure!(!control.cancelled(), Failure::Cancelled);
        if control.paused() {
            tokio::time::sleep(POLL_INTERVAL).await;
            continue;
        }
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
    /// Serialize byte budgets across all concurrent requests without accumulating idle credit
    async fn throttle(&self, bytes: usize) -> Result<()> {
        self.network_bytes
            .set(self.network_bytes.get().saturating_add(bytes as u64));
        if self.speed_limit != 0 {
            let start = self.next_byte.get().max(Instant::now());
            let deadline = start + Duration::from_secs_f64(bytes as f64 / self.speed_limit as f64);
            self.next_byte.set(deadline);
            controlled(tokio::time::sleep_until(deadline.into()), self.control).await?;
        }
        Ok(())
    }

    /// Track each partial exactly once so retries never inflate aggregate progress
    fn report(&self, index: usize, position: u64) {
        self.positions.borrow_mut()[index] = position;
        let received = self
            .positions
            .borrow()
            .iter()
            .fold(self.cached, |sum, value| sum.saturating_add(*value));
        let speed = (self.network_bytes.get() as f64
            / self.started.elapsed().as_secs_f64().max(0.001)) as u64;
        self.control.progress(received, speed);
    }

    /// Resume authenticated immutable chunks and retry only recoverable failures
    async fn chunk(&self, index: usize, chunk: &Chunk) -> Result<()> {
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
            if attempt + 1 < MAX_ATTEMPTS {
                controlled(tokio::time::sleep(retry_delay(attempt)), self.control).await?;
            }
        }
        Err(anyhow::Error::new(Failure::Http { retryable: true }).context(last))
    }

    /// Hash the resumed prefix once and hash incoming bytes while writing
    async fn attempt(&self, index: usize, chunk: &Chunk) -> Result<()> {
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
            // A complete representation replaces the prefix instead of being appended
            file.set_len(0)?;
            file.seek(SeekFrom::Start(0))?;
            position = 0;
            hasher = Sha256::new();
            self.report(index, 0);
        }
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
        while let Some(bytes) = controlled(response.chunk(), self.control).await?? {
            if bytes.len() as u64 > chunk.size - position {
                file.set_len(0)?;
                return Err(Failure::Http { retryable: false }.into());
            }
            // Limit each write so a slow transfer remains responsive and memory stays bounded
            for block in bytes.chunks(64 * 1024) {
                self.throttle(block.len()).await?;
                controlled(std::future::ready(()), self.control).await?;
                file.write_all(block)?;
                hasher.update(block);
                position += block.len() as u64;
                self.report(index, position);
            }
        }
        if position != chunk.size || format!("{:x}", hasher.finalize()) != chunk.digest {
            file.set_len(0)?;
            self.report(index, 0);
            return Err(Failure::Http { retryable: true }.into());
        }
        file.sync_all()?;
        Ok(())
    }
}

/// Own the bounded concurrent download runtime on the caller's worker thread
pub fn download(
    chunks: &[Chunk],
    root: &Path,
    cached: u64,
    speed_limit: u64,
    control: &impl Control,
) -> Result<()> {
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
