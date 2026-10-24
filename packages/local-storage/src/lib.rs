use anyhow::{Context, Result, bail, ensure};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

/// Reject symlinks, junctions and special files without following their targets
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
    /// Anchor operations at an existing directory whose ancestors contain no links
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

    /// Resolve a nonempty relative path after checking each existing component
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

    /// Validate a whole deletion tree before changing any files
    pub fn check_tree(&self, relative: &Path) -> Result<PathBuf> {
        let path = self.path(relative)?;
        if checked_metadata(&path)?.is_some_and(|metadata| metadata.is_dir()) {
            for entry in WalkDir::new(&path).follow_links(false) {
                checked_metadata(entry?.path())?.context("tree changed during validation")?;
            }
        }
        Ok(path)
    }

    /// Preflight all targets and then remove only those rooted files or directories
    pub fn remove_all(&self, relative_paths: &[PathBuf]) -> Result<()> {
        for relative in relative_paths {
            self.check_tree(relative)?;
        }
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

    /// Create a checked directory hierarchy inside the managed root
    pub fn create_dir(&self, relative: &Path) -> Result<()> {
        fs::create_dir_all(self.path(relative)?)?;
        Ok(())
    }

    /// Rename checked paths without deleting the destination first
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

    /// Replace an existing directory and restore it when activation fails
    pub fn replace_directory(
        &self,
        staged: &Path,
        target: &Path,
        backup: &Path,
        commit: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
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

/// Sync and atomically replace a file without exposing a partially written marker or JSON document
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("missing parent")?;
    let root = Root::new(parent)?;
    let path = root.path(Path::new(path.file_name().context("missing filename")?))?;
    if let Some(metadata) = checked_metadata(&path)? {
        ensure!(metadata.is_file(), "destination is not a file");
    }
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}
