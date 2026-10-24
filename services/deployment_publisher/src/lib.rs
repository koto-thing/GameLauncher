pub mod files;
pub mod gc;
pub mod release;
pub mod storage;

use anyhow::{Result, ensure};
use std::sync::atomic::{AtomicBool, Ordering};

pub static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Stop work at a safe boundary before mutable publication begins
pub fn check_cancelled() -> Result<()> {
    ensure!(!CANCELLED.load(Ordering::Relaxed), "publication cancelled");
    Ok(())
}
