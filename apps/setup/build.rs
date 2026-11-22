//! 新規インストール用の IFW online installer を exe へ埋め込む準備をする

use std::{env, fs, path::PathBuf};

/// `PANDD_IFW_INSTALLER` が指す installer を OUT_DIR へ置く
///
/// 指定がなければ空のファイルを置き、更新専用の build にする
///
/// # 戻り値
///
/// 戻り値なし
///
/// # エラー
///
/// 指定された installer を読めない場合は build を失敗させる
fn main() {
    println!("cargo::rerun-if-env-changed=PANDD_IFW_INSTALLER");
    let destination =
        PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("ifw-installer.exe");

    match env::var_os("PANDD_IFW_INSTALLER") {
        Some(source) => {
            let source = PathBuf::from(source);
            println!("cargo::rerun-if-changed={}", source.display());
            fs::copy(&source, &destination)
                .unwrap_or_else(|error| panic!("{} を読めません: {error}", source.display()));
        }
        None => fs::write(&destination, []).expect("空の installer を書けません"),
    }
}
