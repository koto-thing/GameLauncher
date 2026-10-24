pub mod files;
pub mod gc;
pub mod release;
pub mod storage;

use anyhow::{Result, ensure};
use std::sync::atomic::{AtomicBool, Ordering};

pub static CANCELLED: AtomicBool = AtomicBool::new(false);

/// 公開データの更新前の安全な境界でキャンセル要求を確認する
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn check_cancelled() -> Result<()> {
    ensure!(!CANCELLED.load(Ordering::Relaxed), "publication cancelled");
    Ok(())
}
