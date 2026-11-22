//! Qt IFW の installer と maintenance tool を画面なしで実行し、ログから工程を読み取る

use std::{
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc::Sender,
    thread,
};

use anyhow::{Context, Result};

/// IFW へ渡すランチャーの component 名
pub const LAUNCHER_COMPONENT: &str = "org.pandd.launcher";

/// IFW が出力するログから判定できるインストールの工程
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Stage {
    /// 更新情報とメタデータの取得
    Preparing,
    /// パッケージのダウンロード
    Downloading,
    /// パッケージの展開
    Unpacking,
    /// maintenance tool の書き出しなどの仕上げ
    Finalizing,
}

/// IFW の実行中に画面へ送る出来事
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IfwEvent {
    /// 新しい工程に入った
    Stage(Stage),
    /// IFW が出力したログ1行
    Log(String),
    /// IFW が終了した
    Exited {
        /// 通常の完了または必須コンポーネントの更新完了なら true
        success: bool,
    },
    /// IFW を起動できなかった、または終了を待てなかった
    Failed(String),
}

/// 画面なしで実行する IFW のコマンド
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IfwCommand {
    program: PathBuf,
    arguments: Vec<OsString>,
}

impl IfwCommand {
    /// 新規インストール用のコマンドを作る
    ///
    /// # 引数
    ///
    /// * `installer` - binarycreator が作った online installer の実行ファイル
    /// * `root` - ランチャーをインストールするディレクトリ
    ///
    /// # 戻り値
    ///
    /// ライセンスと確認をすべて自動で承諾する install コマンド
    pub fn install(installer: &Path, root: &Path) -> Self {
        let mut arguments: Vec<OsString> = vec!["--root".into(), root.as_os_str().to_owned()];
        arguments.extend(unattended_arguments());
        arguments.extend(["install".into(), LAUNCHER_COMPONENT.into()]);
        Self {
            program: installer.to_owned(),
            arguments,
        }
    }

    /// インストール済みランチャーの更新用コマンドを作る
    ///
    /// # 引数
    ///
    /// * `maintenance_tool` - インストール先にある IFW の maintenance tool
    ///
    /// # 戻り値
    ///
    /// すべての更新を自動で承諾する update コマンド
    pub fn update(maintenance_tool: &Path) -> Self {
        let mut arguments: Vec<OsString> = unattended_arguments().collect();
        arguments.push("update".into());
        Self {
            program: maintenance_tool.to_owned(),
            arguments,
        }
    }

    /// 実行するプログラムを返す
    ///
    /// # 戻り値
    ///
    /// IFW の実行ファイルのパス
    pub fn program(&self) -> &Path {
        &self.program
    }

    /// プログラムへ渡す引数を返す
    ///
    /// # 戻り値
    ///
    /// コマンドラインの引数列
    pub fn arguments(&self) -> &[OsString] {
        &self.arguments
    }
}

/// 確認なしで IFW を最後まで進めるための共通引数を返す
///
/// # 戻り値
///
/// ライセンス承諾、既定回答、確認省略の引数
fn unattended_arguments() -> impl Iterator<Item = OsString> {
    ["--accept-licenses", "--default-answer", "--confirm-command"]
        .into_iter()
        .map(OsString::from)
}

/// IFW のログ1行から工程を判定する
///
/// # 引数
///
/// * `line` - `[経過ミリ秒] メッセージ` 形式のログ1行
///
/// # 戻り値
///
/// 工程の始まりを示す行ならその工程、それ以外は None
pub fn stage_of(line: &str) -> Option<Stage> {
    // 先頭の経過時間を取り除いてメッセージだけを比べる
    let message = line
        .trim()
        .split_once("] ")
        .map_or(line.trim(), |(_, rest)| rest);

    if message.starts_with("Fetching latest update information")
        || message.starts_with("Retrieving information from remote repositories")
    {
        return Some(Stage::Preparing);
    }
    if message.starts_with("Downloading packages") {
        return Some(Stage::Downloading);
    }
    if message.starts_with("Preparing to unpack") || message.starts_with("Unpacking components") {
        return Some(Stage::Unpacking);
    }
    if message.starts_with("Writing maintenance tool") {
        return Some(Stage::Finalizing);
    }
    None
}

/// IFW を起動し、終了するまでログと工程を送り続ける
///
/// 呼出元のスレッドを終了まで止めるので、画面とは別のスレッドで呼ぶ
///
/// # 引数
///
/// * `command` - 実行する IFW のコマンド
/// * `events` - 工程、ログ、終了を受け取る送信先
///
/// # 戻り値
///
/// 戻り値なし。起動や待機の失敗は `IfwEvent::Failed` として送る
pub fn run(command: &IfwCommand, events: &Sender<IfwEvent>) {
    let outcome = run_inner(command, events);
    let event = match outcome {
        Ok(success) => IfwEvent::Exited { success },
        Err(error) => IfwEvent::Failed(format!("{error:#}")),
    };
    let _ = events.send(event);
}

/// IFW を起動して標準出力と標準エラーを読み、終了コードを返す
///
/// # 引数
///
/// * `command` - 実行する IFW のコマンド
/// * `events` - 工程とログの送信先
///
/// # 戻り値
///
/// 通常の完了または必須コンポーネントの更新完了なら true
///
/// # エラー
///
/// プロセスを起動できない、または終了を待てない場合
fn run_inner(command: &IfwCommand, events: &Sender<IfwEvent>) -> Result<bool> {
    // 画面なしで起動し、出力をすべてパイプで受け取る
    let mut process = Command::new(&command.program);
    process
        .args(&command.arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut process);
    let mut child = process
        .spawn()
        .with_context(|| format!("{} を起動できません", command.program.display()))?;

    // 標準出力と標準エラーを別スレッドで読み、パイプの詰まりを防ぐ
    let readers: Vec<_> = [
        child
            .stdout
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
        child
            .stderr
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|pipe| {
        let events = events.clone();
        thread::spawn(move || forward_lines(pipe, &events))
    })
    .collect();
    for reader in readers {
        let _ = reader.join();
    }

    let status = child.wait().context("IFW の終了を待てません")?;
    // Qt IFW は必須コンポーネントの更新完了を EssentialUpdated (6) で通知する
    Ok(matches!(status.code(), Some(0 | 6)))
}

/// パイプから1行ずつ読み、ログと工程を送る
///
/// # 引数
///
/// * `pipe` - IFW の標準出力または標準エラー
/// * `events` - ログと工程の送信先
///
/// # 戻り値
///
/// 戻り値なし。パイプが閉じたら終わる
fn forward_lines(pipe: Box<dyn Read + Send>, events: &Sender<IfwEvent>) {
    // パスに UTF-8 以外が混ざっても読み続けられるようバイト列で受け取る
    let mut reader = BufReader::new(pipe);
    let mut buffer = Vec::new();
    while reader.read_until(b'\n', &mut buffer).unwrap_or(0) > 0 {
        let text = String::from_utf8_lossy(&buffer);
        for line in text
            .split('\r')
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            if let Some(stage) = stage_of(line) {
                let _ = events.send(IfwEvent::Stage(stage));
            }
            let _ = events.send(IfwEvent::Log(line.to_owned()));
        }
        buffer.clear();
    }
}

/// Windows で子プロセスのコンソール窓を出さないようにする
///
/// # 引数
///
/// * `process` - 起動前のコマンド
///
/// # 戻り値
///
/// 戻り値なし
#[cfg(windows)]
fn hide_console(process: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    process.creation_flags(CREATE_NO_WINDOW);
}

/// Windows 以外ではコンソール窓が出ないので何もしない
///
/// # 引数
///
/// * `_process` - 起動前のコマンド
///
/// # 戻り値
///
/// 戻り値なし
#[cfg(not(windows))]
fn hide_console(_process: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn detects_stages_from_ifw_log() {
        assert_eq!(
            stage_of("[19] Fetching latest update information..."),
            Some(Stage::Preparing)
        );
        assert_eq!(
            stage_of("[75] Downloading packages..."),
            Some(Stage::Downloading)
        );
        assert_eq!(
            stage_of("[154] Preparing to unpack components..."),
            Some(Stage::Unpacking)
        );
        assert_eq!(
            stage_of("[1482] Writing maintenance tool: \"C:/x/maintenancetool.exe.new\""),
            Some(Stage::Finalizing)
        );
        assert_eq!(stage_of("[1736] Installation finished!"), None);
        assert_eq!(stage_of("org.test"), None);
    }

    #[test]
    fn builds_unattended_install_command() {
        let command = IfwCommand::install(Path::new("setup.exe"), Path::new("C:/Games/PandD"));
        let arguments: Vec<_> = command
            .arguments()
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            arguments,
            [
                "--root",
                "C:/Games/PandD",
                "--accept-licenses",
                "--default-answer",
                "--confirm-command",
                "install",
                "org.pandd.launcher"
            ]
        );
    }

    #[test]
    fn builds_unattended_update_command() {
        let command = IfwCommand::update(Path::new("maintenancetool.exe"));
        assert_eq!(command.program(), Path::new("maintenancetool.exe"));
        assert_eq!(command.arguments().last().unwrap(), "update");
    }

    #[test]
    fn reports_start_failure() {
        let (sender, receiver) = mpsc::channel();
        run(
            &IfwCommand::update(Path::new("definitely-missing-maintenancetool")),
            &sender,
        );
        assert!(matches!(receiver.recv().unwrap(), IfwEvent::Failed(_)));
    }
}
