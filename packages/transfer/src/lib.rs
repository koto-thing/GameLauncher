use anyhow::Result;
use std::{
    io::{Read, Seek, SeekFrom},
    process::{Command, Output, Stdio},
    time::Duration,
};

#[cfg(feature = "http")]
pub mod download;

pub const MAX_ATTEMPTS: usize = 3;
pub const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Share bounded exponential delays between transfer callers
pub fn retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(200 * (1_u64 << attempt.min(5)))
}

/// Capture provider output without pipe deadlocks and reap cancelled processes
pub fn command_output(
    command: &mut Command,
    checkpoint: impl Fn() -> Result<()>,
) -> Result<Output> {
    checkpoint()?;
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    let mut child = command
        .stdout(Stdio::from(stdout.try_clone()?))
        .stderr(Stdio::from(stderr.try_clone()?))
        .spawn()?;
    let status = loop {
        if let Err(error) = checkpoint() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    };
    stdout.seek(SeekFrom::Start(0))?;
    stderr.seek(SeekFrom::Start(0))?;
    let mut output = Output {
        status,
        stdout: Vec::new(),
        stderr: Vec::new(),
    };
    stdout.read_to_end(&mut output.stdout)?;
    stderr.read_to_end(&mut output.stderr)?;
    Ok(output)
}
