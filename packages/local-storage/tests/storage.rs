use anyhow::Result;
use pandd_local_storage::{Root, write_atomic};
use std::{fs, path::Path};
use tempfile::tempdir;

/// Exercise a failed active-marker write after the directory switch and restore the old release
#[test]
fn marker_failure_restores_old_release_and_keeps_new_staging() -> Result<()> {
    let directory = tempdir()?;
    let root = Root::new(directory.path())?;
    for name in ["stage", "release", "trash", "blocked-marker"] {
        root.create_dir(Path::new(name))?;
    }
    fs::write(root.path(Path::new("stage/game"))?, b"new")?;
    fs::write(root.path(Path::new("release/game"))?, b"old")?;
    let result = root.replace_directory(
        Path::new("stage"),
        Path::new("release"),
        Path::new("trash/backup"),
        || {
            assert_eq!(fs::read(root.path(Path::new("release/game"))?)?, b"new");
            write_atomic(&root.path(Path::new("blocked-marker"))?, b"marker")
        },
    );
    assert!(result.is_err());
    assert_eq!(fs::read(root.path(Path::new("release/game"))?)?, b"old");
    assert_eq!(fs::read(root.path(Path::new("stage/game"))?)?, b"new");
    assert!(!root.path(Path::new("trash/backup"))?.exists());
    Ok(())
}

/// Preserve every recoverable copy and report rollback failure instead of deleting a backup
#[test]
fn failed_rollback_preserves_backup_and_rejects_another_switch() -> Result<()> {
    let directory = tempdir()?;
    let root = Root::new(directory.path())?;
    for name in ["stage", "release", "trash"] {
        root.create_dir(Path::new(name))?;
    }
    fs::write(root.path(Path::new("stage/game"))?, b"new")?;
    fs::write(root.path(Path::new("release/game"))?, b"old")?;
    let result = root.replace_directory(
        Path::new("stage"),
        Path::new("release"),
        Path::new("trash/backup"),
        || {
            root.create_dir(Path::new("stage"))?;
            anyhow::bail!("injected marker failure")
        },
    );
    assert!(format!("{:#}", result.unwrap_err()).contains("cannot return new release"));
    assert_eq!(
        fs::read(root.path(Path::new("trash/backup/game"))?)?,
        b"old"
    );
    assert_eq!(fs::read(root.path(Path::new("release/game"))?)?, b"new");
    assert!(
        root.replace_directory(
            Path::new("stage"),
            Path::new("release"),
            Path::new("trash/backup"),
            || Ok(())
        )
        .is_err()
    );
    Ok(())
}

/// A failed first installation leaves neither an active directory nor a partial marker
#[test]
fn first_install_failure_and_success_are_distinct() -> Result<()> {
    let directory = tempdir()?;
    let root = Root::new(directory.path())?;
    root.create_dir(Path::new("stage"))?;
    root.create_dir(Path::new("trash"))?;
    fs::write(root.path(Path::new("stage/game"))?, b"new")?;
    assert!(
        root.replace_directory(
            Path::new("stage"),
            Path::new("release"),
            Path::new("trash/backup"),
            || anyhow::bail!("failure")
        )
        .is_err()
    );
    assert!(!root.path(Path::new("release"))?.exists());
    root.replace_directory(
        Path::new("stage"),
        Path::new("release"),
        Path::new("trash/backup"),
        || write_atomic(&root.path(Path::new("active.json"))?, b"new-marker"),
    )?;
    assert_eq!(
        fs::read(root.path(Path::new("active.json"))?)?,
        b"new-marker"
    );
    assert_eq!(fs::read(root.path(Path::new("release/game"))?)?, b"new");
    Ok(())
}

/// Preflight the entire deletion plan before deleting the first valid target
#[test]
fn removal_is_confined_and_missing_targets_are_idempotent() -> Result<()> {
    let directory = tempdir()?;
    let root = Root::new(directory.path())?;
    root.create_dir(Path::new("cache/sub"))?;
    fs::write(root.path(Path::new("cache/sub/chunk"))?, b"data")?;
    for invalid in ["../outside", "", ".", "cache/../../outside"] {
        assert!(root.remove_all(&["cache".into(), invalid.into()]).is_err());
        assert!(root.path(Path::new("cache/sub/chunk"))?.exists());
    }
    assert!(root.remove_all(&[directory.path().to_path_buf()]).is_err());
    root.remove_all(&["cache".into(), "missing".into()])?;
    assert!(!root.path(Path::new("cache"))?.exists());
    assert!(directory.path().exists());
    Ok(())
}

/// Never traverse a nested link during cleanup, including when another target is otherwise valid
#[cfg(unix)]
#[test]
fn nested_link_blocks_the_complete_cleanup_plan() -> Result<()> {
    let directory = tempdir()?;
    let outside = tempdir()?;
    fs::write(outside.path().join("keep"), b"external")?;
    let root = Root::new(directory.path())?;
    root.create_dir(Path::new("cache"))?;
    root.create_dir(Path::new("staging"))?;
    std::os::unix::fs::symlink(outside.path(), directory.path().join("cache/link"))?;
    assert!(
        root.remove_all(&["staging".into(), "cache".into()])
            .is_err()
    );
    assert!(directory.path().join("staging").exists());
    assert_eq!(fs::read(outside.path().join("keep"))?, b"external");
    Ok(())
}
