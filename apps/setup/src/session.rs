//! IFW の実行、更新前の準備、ランチャーの起動をまとめる

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc::{self, Receiver},
    thread,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use pandd_setup::ifw::{self, IfwCommand, IfwEvent};
use tempfile::TempDir;

/// release build で埋め込んだ IFW online installer。埋め込みなしの build では空
const EMBEDDED_INSTALLER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ifw-installer.exe"));
/// インストール先の中でのランチャー本体の場所
const LAUNCHER_EXECUTABLE: &str = "bin/PandD Game Launcher.exe";
/// インストール先の中での IFW maintenance tool の場所
const MAINTENANCE_TOOL: &str = "maintenancetool.exe";
/// 更新前にランチャーの終了を待つ上限
const LAUNCHER_EXIT_TIMEOUT: Duration = Duration::from_secs(60);

/// IFW で行う処理
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Plan {
    /// 埋め込み installer で新規インストールする
    Install {
        /// インストール先
        root: PathBuf,
    },
    /// maintenance tool で更新する
    Update {
        /// インストール先
        root: PathBuf,
        /// 終了を待つランチャーのプロセス ID
        wait_pid: Option<u32>,
    },
}

/// 実行中の IFW
pub struct Job {
    /// 工程、ログ、終了の受信口
    pub events: Receiver<IfwEvent>,
    /// 展開した installer を置く一時ディレクトリ。Job と一緒に消す
    _workspace: Option<TempDir>,
}

/// この build に新規インストール用の installer が入っているかを返す
///
/// # 戻り値
///
/// 埋め込み済みなら true。更新専用の build では false
pub fn has_embedded_installer() -> bool {
    !EMBEDDED_INSTALLER.is_empty()
}

/// IFW を別スレッドで実行し始める
///
/// # 引数
///
/// * `plan` - 新規インストールか更新か
///
/// # 戻り値
///
/// 実行中の IFW の受信口
///
/// # エラー
///
/// installer を一時ディレクトリへ書き出せない場合
pub fn start(plan: &Plan) -> Result<Job> {
    let (sender, events) = mpsc::channel();
    match plan.clone() {
        Plan::Install { root } => {
            // installer は exe として一時ディレクトリへ書き出してから実行する
            let workspace = tempfile::Builder::new()
                .prefix("pandd-setup-")
                .tempdir()
                .context("一時ディレクトリを作れません")?;
            let installer = workspace.path().join("PandD-Game-Launcher-IFW.exe");
            fs::write(&installer, EMBEDDED_INSTALLER)
                .with_context(|| format!("{} を書き出せません", installer.display()))?;
            let command = IfwCommand::install(&installer, &root);
            thread::spawn(move || ifw::run(&command, &sender));
            Ok(Job {
                events,
                _workspace: Some(workspace),
            })
        }
        Plan::Update { root, wait_pid } => {
            // ランチャーがファイルを掴んだままだと更新できないので終了を待ってから始める
            let command = IfwCommand::update(&root.join(MAINTENANCE_TOOL));
            thread::spawn(move || {
                if let Some(pid) = wait_pid
                    && let Err(error) = wait_for_exit(pid, LAUNCHER_EXIT_TIMEOUT)
                {
                    let _ = sender.send(IfwEvent::Failed(format!("{error:#}")));
                    return;
                }
                ifw::run(&command, &sender);
            });
            Ok(Job {
                events,
                _workspace: None,
            })
        }
    }
}

/// インストール済みのランチャーを起動する
///
/// # 引数
///
/// * `root` - ランチャーのインストール先
///
/// # 戻り値
///
/// 起動できたら Ok
///
/// # エラー
///
/// ランチャーの実行ファイルを起動できない場合
pub fn launch_launcher(root: &Path) -> Result<()> {
    let executable = root.join(LAUNCHER_EXECUTABLE);
    let directory = executable.parent().unwrap_or(root);
    Command::new(&executable)
        .current_dir(directory)
        .spawn()
        .with_context(|| format!("{} を起動できません", executable.display()))?;
    Ok(())
}

/// 更新対象の中から起動されていたら、一時ディレクトリへ自分を複製して起動し直す
///
/// 更新中の maintenance tool は `bin` の中身を置き換えるため、
/// 実行中のこの exe がその中にあると更新に失敗する
///
/// # 引数
///
/// * `root` - 更新するランチャーのインストール先
///
/// # 戻り値
///
/// 複製から起動し直したなら true。このプロセスはそのまま終わる
///
/// # エラー
///
/// 自分の場所を調べられない、複製できない、起動できない場合
pub fn relaunch_outside(root: &Path) -> Result<bool> {
    let current = env::current_exe().context("実行中のファイルの場所を調べられません")?;
    let root =
        fs::canonicalize(root).with_context(|| format!("{} が見つかりません", root.display()))?;
    let current_canonical = fs::canonicalize(&current).unwrap_or(current.clone());
    if !current_canonical.starts_with(&root) {
        return Ok(false);
    }

    // プロセスごとの一時ディレクトリへ複製し、同じ引数で起動する
    let directory = env::temp_dir().join(format!("pandd-setup-{}", std::process::id()));
    fs::create_dir_all(&directory)
        .with_context(|| format!("{} を作れません", directory.display()))?;
    let copy = directory.join(current.file_name().unwrap_or("PandD Setup.exe".as_ref()));
    fs::copy(&current, &copy).with_context(|| format!("{} へ複製できません", copy.display()))?;
    Command::new(&copy)
        .args(env::args_os().skip(1))
        .spawn()
        .with_context(|| format!("{} を起動できません", copy.display()))?;
    Ok(true)
}

/// 指定したプロセスの終了を待つ
///
/// # 引数
///
/// * `pid` - 待つプロセスの ID
/// * `timeout` - 待つ上限
///
/// # 戻り値
///
/// 終了したか、もともと存在しなければ Ok
///
/// # エラー
///
/// 上限までに終了しない場合
fn wait_for_exit(pid: u32, timeout: Duration) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };

    // 開けないプロセスはすでに終了している
    // SAFETY: 戻り値のハンドルはこの関数の中でだけ使い、必ず閉じる
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return Ok(());
    }
    let milliseconds = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX);
    // SAFETY: handle は上で開いた有効なプロセスハンドル
    let result = unsafe { WaitForSingleObject(handle, milliseconds) };
    // SAFETY: handle は上で開いた有効なプロセスハンドルで、ここで一度だけ閉じる
    unsafe { CloseHandle(handle) };
    if result != WAIT_OBJECT_0 {
        bail!(
            "ランチャーが終了しないため更新を始められません。ランチャーを閉じてからもう一度試してください"
        );
    }
    Ok(())
}
