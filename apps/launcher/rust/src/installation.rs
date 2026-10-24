use anyhow::{Context, Result, ensure};
use pandd_distribution_contracts::schema;
use pandd_local_storage::{Root, write_atomic};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Active {
    schema_version: u32,
    version: String,
}

/// インストール先のルート名が指定されたゲーム ID と一致することを確認する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `game_id` - インストール先と照合するゲーム ID
///
/// # 戻り値
///
/// ゲーム ID とディレクトリ名が一致する管理ルート
fn game_root(path: &Path, game_id: &str) -> Result<Root> {
    schema::relative_path(game_id)?;
    ensure!(
        !game_id.contains('/') && path.file_name().and_then(|name| name.to_str()) == Some(game_id),
        "game root identity mismatch"
    );
    Root::new(path)
}

/// 有効状態マーカーをサイズ制限付きで読み込み削除前に不正な状態を拒否する
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
///
/// # 戻り値
///
/// 有効なマーカー、存在しない場合は None
fn active(root: &Root) -> Result<Option<Active>> {
    let path = root.path(Path::new(".launcher/active.json"))?;
    let input = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    input.take(4097).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 4096, "active marker exceeds limit");
    let marker: Active = serde_json::from_slice(&bytes)?;
    ensure!(marker.schema_version == 1, "invalid active marker schema");
    schema::version(&marker.version)?;
    Ok(Some(marker))
}

/// 検証済みのバージョンからステージングのパスを組み立てる
///
/// # 引数
///
/// * `version` - 対象リリースのバージョン
/// * `imported` - 物理配布からの取込用ステージングを選ぶ場合は true
///
/// # 戻り値
///
/// 対象バージョンのステージング相対パス
fn staging(version: &str, imported: bool) -> Result<PathBuf> {
    schema::version(version)?;
    Ok(PathBuf::from(format!(
        ".launcher/staging/{}{version}",
        if imported { "import-" } else { "" }
    )))
}

/// 新しい有効版と実際に直前まで有効だった版を残して整理対象を選ぶ
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
/// * `version` - 対象リリースのバージョン
/// * `previous` - 直前に有効だったバージョン
///
/// # 戻り値
///
/// 現在版と直前の版を除いた削除対象の相対パス
fn obsolete_releases(root: &Root, version: &str, previous: Option<&str>) -> Result<Vec<PathBuf>> {
    let mut versions = Vec::new();
    for item in fs::read_dir(root.path(Path::new("releases"))?)? {
        let item = item?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("non-UTF-8 release directory"))?;
        let parsed = schema::version(&name)?;
        let relative = PathBuf::from(format!("releases/{name}"));
        ensure!(root.path(&relative)?.is_dir(), "release is not a directory");
        versions.push((parsed, name, relative));
    }
    versions.sort_by(|left, right| right.0.cmp(&left.0));

    // 直前の有効版が不明な場合は現在版より古い最新の版を保持する
    let current = schema::version(version)?;
    let previous = previous
        .filter(|value| *value != version)
        .map(str::to_owned)
        .or_else(|| {
            versions
                .iter()
                .find(|item| item.0 < current)
                .map(|item| item.1.clone())
        });
    Ok(versions
        .into_iter()
        .filter(|item| item.1 != version && Some(&item.1) != previous.as_ref())
        .map(|item| item.2)
        .collect())
}

/// 検証済みのステージングを有効化し確定後の整理失敗は警告として返す
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `game_id` - インストール先と照合するゲーム ID
/// * `version` - 対象リリースのバージョン
/// * `entrypoint` - リリース内の起動ファイルの相対パス
/// * `imported` - 物理配布からの取込用ステージングを選ぶ場合は true
///
/// # 戻り値
///
/// 有効化後の整理に失敗した場合は警告文字列、完了時は空文字列
pub fn activate(
    path: &Path,
    game_id: &str,
    version: &str,
    entrypoint: &str,
    imported: bool,
) -> Result<String> {
    // ゲームの識別情報とステージング内の起動ファイルを確認する
    let root = game_root(path, game_id)?;
    let stage = staging(version, imported)?;
    let source = stage.join("release");
    schema::relative_path(entrypoint)?;
    ensure!(
        root.path(&source.join(entrypoint))?.is_file(),
        "staged entrypoint is missing"
    );

    // 復旧に必要な直前の状態を取得して切替先と退避先を用意する
    let previous = active(&root)?;
    let target = PathBuf::from(format!("releases/{version}"));
    let backup = PathBuf::from(format!(".launcher/trash/{version}"));
    root.create_dir(Path::new("releases"))?;
    root.create_dir(Path::new(".launcher/trash"))?;
    let marker = serde_json::to_vec(&Active {
        schema_version: 1,
        version: version.into(),
    })?;

    // ディレクトリの切替と有効状態マーカーの保存をまとめて確定する
    root.replace_directory(&source, &target, &backup, || {
        write_atomic(&root.path(Path::new(".launcher/active.json"))?, &marker)
    })?;

    // マーカーは確定済みのため整理失敗を有効化の失敗として扱わない
    let cleanup = (|| -> Result<()> {
        let mut obsolete = obsolete_releases(
            &root,
            version,
            previous.as_ref().map(|value| value.version.as_str()),
        )?;
        obsolete.extend([stage, backup]);
        root.remove_all(&obsolete)
    })();
    Ok(cleanup
        .err()
        .map(|error| format!("release activated; cleanup incomplete: {error:#}"))
        .unwrap_or_default())
}

/// 中断や復旧失敗の情報を失わないよう未解決のバックアップを保護する
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn require_no_backup(root: &Root) -> Result<()> {
    let trash = root.path(Path::new(".launcher/trash"))?;
    if trash.exists() {
        ensure!(
            fs::read_dir(trash)?.next().is_none(),
            "unresolved rollback backup; temporary cleanup refused"
        );
    }
    Ok(())
}

/// 有効リリースの識別情報を確認して一時データだけを削除する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `game_id` - インストール先と照合するゲーム ID
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn cleanup(path: &Path, game_id: &str) -> Result<()> {
    let root = game_root(path, game_id)?;
    let marker = active(&root)?.context("active marker missing")?;
    ensure!(
        root.path(Path::new(&format!("releases/{}", marker.version)))?
            .is_dir(),
        "active release missing"
    );
    require_no_backup(&root)?;
    root.remove_all(&[".launcher/staging".into(), ".launcher/cache".into()])
}

/// キャッシュや復旧データを残して失敗したステージングだけを削除する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `game_id` - インストール先と照合するゲーム ID
/// * `version` - 対象リリースのバージョン
/// * `imported` - 物理配布からの取込用ステージングを選ぶ場合は true
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn discard(path: &Path, game_id: &str, version: &str, imported: bool) -> Result<()> {
    let stage = staging(version, imported)?;
    if fs::symlink_metadata(path).is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound) {
        return Ok(());
    }
    let root = game_root(path, game_id)?;
    require_no_backup(&root)?;
    root.remove_all(&[stage])
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 有効化ごとに起動ファイルを持つ独立したテスト用ゲームルートを作成する
    fn prepare(directory: &TempDir, version: &str, content: &[u8]) -> Result<PathBuf> {
        let game = directory.path().join("sample-game");
        let source = game.join(staging(version, false)?).join("release/bin");
        fs::create_dir_all(&source)?;
        fs::write(source.join("game"), content)?;
        Ok(game)
    }

    /// 無関係な新版ディレクトリがあっても実際に直前まで有効だった版を残す
    #[test]
    fn activation_retains_previous_and_cleanup_preserves_active() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let game = prepare(&directory, "1.0.0", b"one")?;
        assert!(activate(&game, "sample-game", "1.0.0", "bin/game", false)?.is_empty());
        fs::create_dir_all(game.join("releases/9.0.0"))?;
        prepare(&directory, "2.0.0", b"two")?;
        assert!(activate(&game, "sample-game", "2.0.0", "bin/game", false)?.is_empty());
        assert!(game.join("releases/1.0.0/bin/game").exists());
        assert!(!game.join("releases/9.0.0").exists());
        prepare(&directory, "3.0.0", b"three")?;
        activate(&game, "sample-game", "3.0.0", "bin/game", false)?;
        assert!(!game.join("releases/1.0.0").exists());
        assert!(game.join("releases/2.0.0/bin/game").exists());
        fs::create_dir_all(game.join(".launcher/cache/sha256"))?;
        fs::write(game.join(".launcher/cache/sha256/unused"), b"chunk")?;
        cleanup(&game, "sample-game")?;
        assert!(!game.join(".launcher/cache").exists());
        assert_eq!(
            active(&game_root(&game, "sample-game")?)?.unwrap().version,
            "3.0.0"
        );
        assert_eq!(fs::read(game.join("releases/3.0.0/bin/game"))?, b"three");
        Ok(())
    }

    /// 同じ版の修復と取込で旧バックアップを残さず切り替える
    #[test]
    fn same_version_repair_and_import_use_the_same_commit() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let game = prepare(&directory, "1.0.0", b"old")?;
        activate(&game, "sample-game", "1.0.0", "bin/game", false)?;
        prepare(&directory, "1.0.0", b"repaired")?;
        activate(&game, "sample-game", "1.0.0", "bin/game", false)?;
        assert_eq!(fs::read(game.join("releases/1.0.0/bin/game"))?, b"repaired");
        assert!(!game.join(".launcher/trash/1.0.0").exists());
        let imported = game.join(staging("2.0.0", true)?).join("release");
        fs::create_dir_all(&imported)?;
        fs::write(imported.join("game"), b"import")?;
        activate(&game, "sample-game", "2.0.0", "game", true)?;
        assert_eq!(fs::read(game.join("releases/2.0.0/game"))?, b"import");
        Ok(())
    }

    /// 不正な識別情報、壊れた状態、未解決の復旧データがあれば整理を拒否する
    #[test]
    fn cleanup_fails_closed_without_losing_recovery_data() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let game = prepare(&directory, "1.0.0", b"one")?;
        assert!(cleanup(&game, "sample-game").is_err());
        assert!(activate(&game, "other-game", "1.0.0", "bin/game", false).is_err());
        activate(&game, "sample-game", "1.0.0", "bin/game", false)?;
        fs::create_dir_all(game.join(".launcher/staging/unfinished"))?;
        fs::create_dir_all(game.join(".launcher/trash/1.0.0"))?;
        assert!(cleanup(&game, "sample-game").is_err());
        assert!(discard(&game, "sample-game", "1.0.0", false).is_err());
        assert!(game.join(".launcher/staging/unfinished").exists());
        fs::write(game.join(".launcher/active.json"), b"invalid")?;
        assert!(cleanup(&game, "sample-game").is_err());
        assert!(game.join("releases/1.0.0/bin/game").exists());
        Ok(())
    }

    /// 有効化の成功と確定後の整理失敗を区別する
    #[test]
    fn cleanup_warning_does_not_undo_a_committed_release() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let game = prepare(&directory, "1.0.0", b"one")?;
        fs::create_dir_all(game.join("releases/not-a-version"))?;
        let warning = activate(&game, "sample-game", "1.0.0", "bin/game", false)?;
        assert!(warning.contains("cleanup incomplete"));
        assert_eq!(
            active(&game_root(&game, "sample-game")?)?.unwrap().version,
            "1.0.0"
        );
        assert!(game.join("releases/1.0.0/bin/game").exists());
        Ok(())
    }
}
