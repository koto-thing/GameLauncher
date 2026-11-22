//! セットアップの起動引数を解釈する

use std::{ffi::OsString, path::PathBuf};

use anyhow::{Context, Result, bail};

/// 画面の見た目
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThemeKind {
    /// キャラクターナビ
    #[default]
    Navi,
    /// アーケード
    Arcade,
}

impl ThemeKind {
    /// もう一方の見た目を返す
    ///
    /// # 戻り値
    ///
    /// ナビならアーケード、アーケードならナビ
    pub fn toggled(self) -> Self {
        match self {
            Self::Navi => Self::Arcade,
            Self::Arcade => Self::Navi,
        }
    }
}

/// セットアップで行う処理
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
    /// 埋め込んだ IFW installer で新規インストールする
    Install,
    /// インストール済みランチャーを maintenance tool で更新する
    Update {
        /// ランチャーのインストール先
        root: PathBuf,
        /// 終了を待つランチャーのプロセス ID
        wait_pid: Option<u32>,
    },
}

/// 起動引数を解釈した結果
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    /// 行う処理
    pub mode: Mode,
    /// 最初に表示する見た目
    pub theme: ThemeKind,
}

/// 起動引数を解釈する
///
/// 引数なしなら新規インストール、`--update --root <dir> [--wait-pid <pid>]` なら更新。
/// どちらも `--theme navi|arcade` で最初の見た目を選べる
///
/// # 引数
///
/// * `arguments` - プログラム名を除いた起動引数
///
/// # 戻り値
///
/// 解釈した処理と見た目
///
/// # エラー
///
/// 不明な引数、値の欠落、`--update` なのに `--root` がない場合
pub fn parse(arguments: impl IntoIterator<Item = OsString>) -> Result<Options> {
    let mut arguments = arguments.into_iter();
    let mut update = false;
    let mut root = None;
    let mut wait_pid = None;
    let mut theme = ThemeKind::default();

    while let Some(argument) = arguments.next() {
        let argument = argument.to_string_lossy().into_owned();
        match argument.as_str() {
            "--update" => update = true,
            "--root" => root = Some(PathBuf::from(value(&mut arguments, "--root")?)),
            "--wait-pid" => {
                let text = value(&mut arguments, "--wait-pid")?;
                let pid = text
                    .to_string_lossy()
                    .parse()
                    .with_context(|| format!("--wait-pid の値が数値ではありません: {text:?}"))?;
                wait_pid = Some(pid);
            }
            "--theme" => {
                theme = match value(&mut arguments, "--theme")?.to_string_lossy().as_ref() {
                    "navi" => ThemeKind::Navi,
                    "arcade" => ThemeKind::Arcade,
                    other => bail!("--theme には navi か arcade を指定してください: {other}"),
                }
            }
            other => bail!("不明な引数です: {other}"),
        }
    }

    // 更新はインストール先が必須で、新規インストールでは更新用の引数を受け付けない
    let mode = match (update, root) {
        (true, Some(root)) => Mode::Update { root, wait_pid },
        (true, None) => bail!("--update には --root が必要です"),
        (false, None) if wait_pid.is_none() => Mode::Install,
        (false, _) => bail!("--root と --wait-pid は --update と一緒に指定してください"),
    };
    Ok(Options { mode, theme })
}

/// オプションの次の値を取り出す
///
/// # 引数
///
/// * `arguments` - 残りの起動引数
/// * `name` - 値を必要とするオプション名
///
/// # 戻り値
///
/// オプションの値
///
/// # エラー
///
/// 値がない場合
fn value(arguments: &mut impl Iterator<Item = OsString>, name: &str) -> Result<OsString> {
    arguments
        .next()
        .with_context(|| format!("{name} の値がありません"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 文字列の配列を起動引数として解釈する
    ///
    /// # 引数
    ///
    /// * `arguments` - 起動引数
    ///
    /// # 戻り値
    ///
    /// 解釈の結果
    fn parse_strings(arguments: &[&str]) -> Result<Options> {
        parse(arguments.iter().map(OsString::from))
    }

    #[test]
    fn defaults_to_install_with_navi() {
        assert_eq!(
            parse_strings(&[]).unwrap(),
            Options {
                mode: Mode::Install,
                theme: ThemeKind::Navi
            }
        );
    }

    #[test]
    fn parses_update_arguments() {
        let options = parse_strings(&[
            "--update",
            "--root",
            "C:/PandD",
            "--wait-pid",
            "42",
            "--theme",
            "arcade",
        ])
        .unwrap();
        assert_eq!(
            options.mode,
            Mode::Update {
                root: PathBuf::from("C:/PandD"),
                wait_pid: Some(42)
            }
        );
        assert_eq!(options.theme, ThemeKind::Arcade);
    }

    #[test]
    fn rejects_incomplete_arguments() {
        assert!(parse_strings(&["--update"]).is_err());
        assert!(parse_strings(&["--root", "C:/PandD"]).is_err());
        assert!(parse_strings(&["--wait-pid", "x", "--update", "--root", "C:/"]).is_err());
        assert!(parse_strings(&["--theme", "retro"]).is_err());
        assert!(parse_strings(&["--unknown"]).is_err());
    }
}
