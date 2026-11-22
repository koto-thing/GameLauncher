//! ランチャーのインストール先を決めて検証する

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

/// ランチャー専用ディレクトリの名前
pub const LAUNCHER_DIRECTORY_NAME: &str = "PandDGameLauncher";

/// インストール先ディレクトリの状態
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectoryState {
    /// 存在しないか空なので、そのまま使える
    Empty,
    /// ファイルがあるので使えない
    NotEmpty,
    /// ファイルがある場所を指している
    NotDirectory,
    /// 中身を読めない
    Unreadable,
}

/// ユーザー権限で書き込める既定のインストール先を返す
///
/// # 引数
///
/// * `local_app_data` - Windows の `%LOCALAPPDATA%`
///
/// # 戻り値
///
/// `%LOCALAPPDATA%\Programs\PandDGameLauncher`
pub fn default_root(local_app_data: &Path) -> PathBuf {
    local_app_data
        .join("Programs")
        .join(LAUNCHER_DIRECTORY_NAME)
}

/// 選ばれたフォルダから、ランチャー専用の最終的なインストール先を作る
///
/// 親フォルダを選んだ場合でもほかのファイルと混ざらないよう、
/// 末尾が専用ディレクトリ名でなければ付け足す
///
/// # 引数
///
/// * `selected` - 入力または選択されたフォルダ
///
/// # 戻り値
///
/// 末尾が `PandDGameLauncher` のパス。入力が空なら None
pub fn final_install_path(selected: &str) -> Option<PathBuf> {
    let trimmed = selected.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    let already_dedicated = path
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(LAUNCHER_DIRECTORY_NAME));
    if already_dedicated {
        Some(path)
    } else {
        Some(path.join(LAUNCHER_DIRECTORY_NAME))
    }
}

/// インストール先として使えるかを調べる
///
/// # 引数
///
/// * `path` - 最終的なインストール先
///
/// # 戻り値
///
/// ディレクトリの状態
pub fn inspect(path: &Path) -> DirectoryState {
    match fs::metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => DirectoryState::Empty,
        Err(_) => DirectoryState::Unreadable,
        Ok(metadata) if !metadata.is_dir() => DirectoryState::NotDirectory,
        Ok(_) => match fs::read_dir(path).map(|mut entries| entries.next().is_none()) {
            Err(_) => DirectoryState::Unreadable,
            Ok(true) => DirectoryState::Empty,
            Ok(false) => DirectoryState::NotEmpty,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_the_dedicated_directory() {
        assert_eq!(
            final_install_path("D:\\Games\\"),
            Some(PathBuf::from("D:\\Games").join(LAUNCHER_DIRECTORY_NAME))
        );
        assert_eq!(
            final_install_path("D:/Games/pandDgamelauncher"),
            Some(PathBuf::from("D:/Games/pandDgamelauncher"))
        );
        assert_eq!(final_install_path("   "), None);
    }

    #[test]
    fn builds_the_default_root_under_programs() {
        assert_eq!(
            default_root(Path::new("C:/Users/player/AppData/Local")),
            Path::new("C:/Users/player/AppData/Local/Programs/PandDGameLauncher")
        );
    }

    #[test]
    fn inspects_directory_states() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        assert_eq!(inspect(&missing), DirectoryState::Empty);

        fs::create_dir(&missing).unwrap();
        assert_eq!(inspect(&missing), DirectoryState::Empty);

        let file = missing.join("file.txt");
        fs::write(&file, b"x").unwrap();
        assert_eq!(inspect(&missing), DirectoryState::NotEmpty);
        assert_eq!(inspect(&file), DirectoryState::NotDirectory);
    }
}
