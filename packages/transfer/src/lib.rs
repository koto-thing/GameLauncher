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

/// 転送処理で共有する上限付き指数バックオフの待機時間を返す
///
/// # 引数
///
/// * `attempt` - 0から始まる再試行の番号
///
/// # 戻り値
///
/// 上限付きの指数バックオフ待機時間
pub fn retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(200 * (1_u64 << attempt.min(5)))
}

/// パイプのデッドロックを避けて外部コマンドの出力を取得し中断時は子プロセスを回収する
///
/// # 引数
///
/// * `command` - 起動する外部コマンド
/// * `checkpoint` - 継続可能かを確認し、中断時にエラーを返す関数
///
/// # 戻り値
///
/// 子プロセスの終了状態と標準出力・標準エラー
pub fn command_output(
    command: &mut Command,
    checkpoint: impl Fn() -> Result<()>,
) -> Result<Output> {
    // 出力を一時ファイルへ逃がしてパイプの容量による停止を避ける
    checkpoint()?;
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    let mut child = command
        .stdout(Stdio::from(stdout.try_clone()?))
        .stderr(Stdio::from(stderr.try_clone()?))
        .spawn()?;

    // 終了とキャンセルを監視し中断時も子プロセスを回収する
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

    // 子プロセスの終了後に標準出力と標準エラーを読み戻す
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
