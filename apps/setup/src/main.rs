//! PandD Game Launcher のセットアップと更新の画面
//!
//! 新規インストールでは埋め込んだ Qt IFW online installer を、
//! 更新とアンインストールではインストール先の maintenance tool を画面なしで実行し、
//! その間はキャラクターナビかアーケードの画面を見せる

#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod session;
#[cfg(windows)]
mod theme;

use std::process::ExitCode;

/// 起動引数を解釈し、セットアップの画面を開く
///
/// # 戻り値
///
/// 正常に閉じたら成功、引数や起動に問題があれば失敗
#[cfg(windows)]
fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("PandD Game Launcher セットアップ")
                .set_description(format!("{error:#}"))
                .show();
            ExitCode::FAILURE
        }
    }
}

/// セットアップの準備をしてウィンドウを開く
///
/// # 戻り値
///
/// ウィンドウを閉じたら Ok
///
/// # エラー
///
/// 起動引数が正しくない、更新の準備ができない、ウィンドウを開けない場合
#[cfg(windows)]
fn run() -> anyhow::Result<()> {
    use anyhow::{Context, bail};
    use eframe::egui;
    use pandd_setup::{cli, install_dir};

    let options = cli::parse(std::env::args_os().skip(1))?;

    // 対象の中で動いていると自分を置き換えも削除もできないので、外へ出てから始める
    if let cli::Mode::Update { root, .. } | cli::Mode::Maintenance { root } = &options.mode
        && session::relaunch_outside(root)?
    {
        return Ok(());
    }
    if options.mode == cli::Mode::Install && !session::has_embedded_installer() {
        bail!(
            "この PandD Setup は更新専用です。新規インストールには配布サイトのインストーラーを使ってください"
        );
    }
    let local_app_data =
        std::env::var_os("LOCALAPPDATA").context("LOCALAPPDATA が設定されていません")?;
    let default_root = install_dir::default_root(local_app_data.as_ref());

    let title = match options.mode {
        cli::Mode::Maintenance { .. } => "PandD Game Launcher のメンテナンス",
        cli::Mode::Install | cli::Mode::Update { .. } => "PandD Game Launcher セットアップ",
    };
    // タイトルバーとタスクバーにも PandD のロゴを出す
    let icon =
        eframe::icon_data::from_png_bytes(include_bytes!("../../../assets/images/PandDLogo.png"))
            .context("同梱のロゴを読めません")?;
    let native = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title(title)
            .with_icon(icon)
            .with_inner_size([760.0, 490.0])
            .with_resizable(false)
            .with_maximize_button(false),
        ..Default::default()
    };
    eframe::run_native(
        "pandd-setup",
        native,
        Box::new(move |context| {
            Ok(Box::new(app::SetupApp::new(
                context,
                options.mode,
                options.theme,
                default_root,
            )))
        }),
    )
    .map_err(|error| anyhow::anyhow!("ウィンドウを開けません: {error}"))
}

/// Windows 以外ではセットアップを使わない
///
/// # 戻り値
///
/// 常に失敗
#[cfg(not(windows))]
fn main() -> ExitCode {
    eprintln!("PandD Setup は Windows 専用です");
    ExitCode::FAILURE
}
