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
use pandd_setup::ifw::{self, IfwCommand, IfwEvent, Stage};
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
    /// maintenance tool でアンインストールする
    Uninstall {
        /// インストール先
        root: PathBuf,
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
/// * `plan` - 新規インストール、更新、アンインストールのどれか
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
                run_maintenance(&command, &root, &sender);
            });
            Ok(Job {
                events,
                _workspace: None,
            })
        }
        Plan::Uninstall { root } => {
            // purge のログには工程の区切りがないので、始める前に削除の工程へ進める
            let command = IfwCommand::purge(&root.join(MAINTENANCE_TOOL));
            let _ = sender.send(IfwEvent::Stage(Stage::Removing));
            thread::spawn(move || run_maintenance(&command, &root, &sender));
            Ok(Job {
                events,
                _workspace: None,
            })
        }
    }
}

/// 更新先に書き込み権限がなければ IFW の実行だけを昇格する
fn run_maintenance(command: &IfwCommand, root: &Path, sender: &mpsc::Sender<IfwEvent>) {
    // ユーザーごとのインストールでは通常権限のログと進捗を使う
    match tempfile::tempfile_in(root) {
        Ok(probe) => {
            drop(probe);
            ifw::run(command, sender);
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            let event = match run_elevated(command, root) {
                Ok(ifw::Outcome::Failed) => IfwEvent::Failed(format!(
                    "メンテナンスに失敗しました。詳細は {} を確認してください",
                    root.join("InstallationLog.txt").display()
                )),
                Ok(outcome) => IfwEvent::Exited(outcome),
                Err(error) => IfwEvent::Failed(format!("{error:#}")),
            };
            let _ = sender.send(event);
        }
        Err(error) => {
            let _ = sender.send(IfwEvent::Failed(format!("{}: {error}", root.display())));
        }
    }
}

/// Windows の同意画面を通してインストール済みの IFW を実行し、終了コードを取得する
fn run_elevated(command: &IfwCommand, root: &Path) -> Result<ifw::Outcome> {
    use std::os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    };
    use windows_sys::Win32::{
        Foundation::WAIT_OBJECT_0,
        System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject},
        UI::Shell::{
            SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
        },
    };

    // update と purge の引数は IFW 用の固定語だけ。パスは個別に渡す
    let program: Vec<_> = command
        .program()
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect();
    let directory: Vec<_> = root.as_os_str().encode_wide().chain([0]).collect();
    let args = command.arguments().join(std::ffi::OsStr::new(" "));
    let args: Vec<_> = args.encode_wide().chain([0]).collect();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: windows_sys::w!("runas"),
        lpFile: program.as_ptr(),
        lpParameters: args.as_ptr(),
        lpDirectory: directory.as_ptr(),
        ..Default::default()
    };

    // SAFETY: 文字列は呼び出し中有効で、返されたハンドルはこの関数で所有する
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(std::io::Error::last_os_error())
            .context("管理者権限でメンテナンスを開始できませんでした");
    }
    anyhow::ensure!(
        !info.hProcess.is_null(),
        "メンテナンスのプロセスを取得できません"
    );
    let child = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
    let mut code = 0;

    // SAFETY: 終了を待つ間ハンドルは有効で、code は書き込み可能
    unsafe {
        if WaitForSingleObject(child.as_raw_handle(), INFINITE) != WAIT_OBJECT_0
            || GetExitCodeProcess(child.as_raw_handle(), &mut code) == 0
        {
            return Err(std::io::Error::last_os_error())
                .context("メンテナンスの終了を確認できません");
        }
    }
    Ok(ifw::Outcome::from_code(Some(code as i32)))
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
/// 更新やアンインストール中の maintenance tool は `bin` の中身を置き換えたり消したりするため、
/// 実行中のこの exe がその中にあると失敗する
///
/// # 引数
///
/// * `root` - 更新またはアンインストールするランチャーのインストール先
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
    // 作業ディレクトリも移し、インストール先のディレクトリを掴んだままにしない
    let directory = env::temp_dir().join(format!("pandd-setup-{}", std::process::id()));
    fs::create_dir_all(&directory)
        .with_context(|| format!("{} を作れません", directory.display()))?;
    let copy = directory.join(current.file_name().unwrap_or("PandD Setup.exe".as_ref()));
    fs::copy(&current, &copy).with_context(|| format!("{} へ複製できません", copy.display()))?;
    Command::new(&copy)
        .args(env::args_os().skip(1))
        .current_dir(&directory)
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
