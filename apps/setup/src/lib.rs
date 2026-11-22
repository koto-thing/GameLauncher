//! PandD Game Launcher のセットアップ画面を支える、OS と描画に依存しない処理
//!
//! Qt IFW の実行と進捗の読み取り、インストール先の検証、
//! インストール中に遊べるシューティングのゲームロジックを提供する

pub mod cli;
pub mod ifw;
pub mod install_dir;
pub mod progress;
pub mod shooter;
