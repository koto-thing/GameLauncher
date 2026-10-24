use anyhow::{Context, Result, bail, ensure};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

/// リンク先をたどらずシンボリックリンク、ジャンクション、特殊ファイルを拒否する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 存在する場合は検証済みメタデータ、存在しない場合は None
fn checked_metadata(path: &Path) -> Result<Option<fs::Metadata>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        !metadata.file_type().is_symlink(),
        "symbolic link is forbidden: {}",
        path.display()
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            metadata.file_attributes() & 0x400 == 0,
            "reparse point is forbidden: {}",
            path.display()
        );
    }
    ensure!(
        metadata.is_file() || metadata.is_dir(),
        "special file is forbidden: {}",
        path.display()
    );
    Ok(Some(metadata))
}

pub struct Root {
    path: PathBuf,
}

impl Root {
    /// 祖先にリンクを含まない既存ディレクトリを操作の基準にする
    ///
    /// # 引数
    ///
    /// * `path` - 操作または検証の対象パス
    ///
    /// # 戻り値
    ///
    /// 検証済みの絶対パスを保持する管理ルート
    pub fn new(path: &Path) -> Result<Self> {
        let absolute = std::path::absolute(path)?;
        for ancestor in absolute.ancestors() {
            ensure!(
                checked_metadata(ancestor)?.is_some_and(|m| m.is_dir()),
                "unsafe or missing storage root: {}",
                ancestor.display()
            );
        }
        Ok(Self {
            path: absolute.canonicalize()?,
        })
    }

    /// 既存の各要素を検証して空でない相対パスを解決する
    ///
    /// # 引数
    ///
    /// * `relative` - 管理ルートからの相対パス
    ///
    /// # 戻り値
    ///
    /// 管理ルート内に収まる検証済みの絶対パス
    pub fn path(&self, relative: &Path) -> Result<PathBuf> {
        ensure!(!relative.as_os_str().is_empty(), "empty managed path");
        let mut result = self.path.clone();
        for component in relative.components() {
            let Component::Normal(name) = component else {
                bail!("managed path must be relative without traversal");
            };
            ensure!(
                !name.to_string_lossy().contains([':', '\\']),
                "invalid managed path component"
            );
            result.push(name);
            checked_metadata(&result)?;
        }
        ensure!(
            result != self.path && result.starts_with(&self.path),
            "managed path escapes root"
        );
        Ok(result)
    }

    /// ファイルを変更する前に削除対象のツリー全体を検証する
    ///
    /// # 引数
    ///
    /// * `relative` - 管理ルートからの相対パス
    ///
    /// # 戻り値
    ///
    /// 配下の既存要素を検証済みの絶対パス
    pub fn check_tree(&self, relative: &Path) -> Result<PathBuf> {
        let path = self.path(relative)?;
        if checked_metadata(&path)?.is_some_and(|metadata| metadata.is_dir()) {
            for entry in WalkDir::new(&path).follow_links(false) {
                checked_metadata(entry?.path())?.context("tree changed during validation")?;
            }
        }
        Ok(path)
    }

    /// 全対象を事前検証して管理ルート内のファイルとディレクトリを削除する
    ///
    /// # 引数
    ///
    /// * `relative_paths` - 削除対象の相対パスの一覧
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    pub fn remove_all(&self, relative_paths: &[PathBuf]) -> Result<()> {
        // 一件も削除する前に全対象の安全性を確認する
        for relative in relative_paths {
            self.check_tree(relative)?;
        }

        // 実際の削除直前にもツリーを再確認する
        for relative in relative_paths {
            let path = self.check_tree(relative)?;
            if let Some(metadata) = checked_metadata(&path)? {
                if metadata.is_dir() {
                    fs::remove_dir_all(&path)?;
                } else {
                    fs::remove_file(&path)?;
                }
            }
        }
        Ok(())
    }

    /// 管理ルート内に検証済みのディレクトリ階層を作成する
    ///
    /// # 引数
    ///
    /// * `relative` - 管理ルートからの相対パス
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    pub fn create_dir(&self, relative: &Path) -> Result<()> {
        fs::create_dir_all(self.path(relative)?)?;
        Ok(())
    }

    /// 移動先を事前に削除せず検証済みのパス間で名前を変更する
    ///
    /// # 引数
    ///
    /// * `source` - 入力ファイルまたはディレクトリのパス
    /// * `destination` - 書込先のパス
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    pub fn rename(&self, source: &Path, destination: &Path) -> Result<()> {
        let source = self.path(source)?;
        let destination = self.path(destination)?;
        ensure!(
            !destination.exists(),
            "rename destination already exists: {}",
            destination.display()
        );
        fs::rename(source, destination)?;
        Ok(())
    }

    /// 既存ディレクトリを切り替え、有効化に失敗した場合は元に戻す
    ///
    /// # 引数
    ///
    /// * `staged` - 切替元のステージングディレクトリの相対パス
    /// * `target` - 有効化するディレクトリの相対パス
    /// * `backup` - 旧ディレクトリを退避する相対パス
    /// * `commit` - 切替後に有効状態を確定する処理
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    pub fn replace_directory(
        &self,
        staged: &Path,
        target: &Path,
        backup: &Path,
        commit: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
        // 切替元、切替先、退避先を検証して重なりを拒否する
        let source = self.check_tree(staged)?;
        let destination = self.check_tree(target)?;
        let saved = self.path(backup)?;
        ensure!(source.is_dir(), "staged release is missing");
        ensure!(
            !saved.exists(),
            "unresolved rollback backup: {}",
            saved.display()
        );
        for (left, right) in [
            (&source, &destination),
            (&source, &saved),
            (&destination, &saved),
        ] {
            ensure!(
                !left.starts_with(right) && !right.starts_with(left),
                "transaction paths overlap"
            );
        }

        // 既存リリースを退避して新しいリリースへ切り替える
        let had_target = destination.exists();
        if had_target {
            ensure!(destination.is_dir(), "release target is not a directory");
            self.rename(target, backup)?;
        }
        if let Err(error) = self.rename(staged, target) {
            if had_target {
                self.rename(backup, target).with_context(|| {
                    format!("{error:#}; rollback failed; backup: {}", saved.display())
                })?;
            }
            return Err(error);
        }

        // 状態の確定に失敗した場合は新版をステージングへ戻して旧版を復元する
        if let Err(error) = commit() {
            self.rename(target, staged)
                .with_context(|| format!("{error:#}; cannot return new release to staging"))?;
            if had_target {
                self.rename(backup, target).with_context(|| {
                    format!("{error:#}; rollback failed; backup: {}", saved.display())
                })?;
            }
            return Err(error);
        }
        Ok(())
    }
}

/// マーカーや JSON の書込途中を公開せず同期して原子的に置き換える
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `bytes` - 処理対象のバイト列
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("missing parent")?;
    let root = Root::new(parent)?;
    let path = root.path(Path::new(path.file_name().context("missing filename")?))?;
    if let Some(metadata) = checked_metadata(&path)? {
        ensure!(metadata.is_file(), "destination is not a file");
    }

    // 同じディレクトリの一時ファイルを同期してから保存先へ置き換える
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}
