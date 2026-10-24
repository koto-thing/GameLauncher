use crate::{check_cancelled, files, storage::ObjectStore};
use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Duration, Utc};
use pandd_distribution_contracts::schema as contracts;
use regex::Regex;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// Plan all removals before deleting anything and retain current and previous releases
fn plan(objects: &[Value], read: impl Fn(&str) -> Result<Value>, days: u32) -> Result<Vec<String>> {
    ensure!(
        days >= 7,
        "cleanup grace period must be at least seven days"
    );
    let latest_pattern = Regex::new(
        r"^v1/games/[^/]+/releases/(?:windows|macos|linux)/(?:x86_64|arm64)/latest\.json$",
    )?;
    let inventory: BTreeMap<String, &Value> = objects
        .iter()
        .map(|object| {
            Ok((
                object["Key"].as_str().context("inventory key")?.to_owned(),
                object,
            ))
        })
        .collect::<Result<_>>()?;
    let latest: Vec<_> = inventory
        .keys()
        .filter(|key| latest_pattern.is_match(key))
        .collect();
    let blobs: Vec<_> = inventory
        .keys()
        .filter(|key| key.starts_with("v1/blobs/sha256/"))
        .collect();
    ensure!(
        !latest.is_empty() || blobs.is_empty(),
        "blobs exist without a latest manifest; refusing cleanup"
    );
    let mut retained = BTreeSet::new();
    let mut roots = BTreeSet::new();
    let mut referenced = BTreeSet::new();
    for key in latest {
        let root = key.strip_suffix("/latest.json").unwrap();
        roots.insert(root.to_owned());
        let document = read(key)?;
        let current = contracts::version(document["version"].as_str().context("latest version")?)?;
        let mut versions = BTreeMap::new();
        for candidate in inventory.keys() {
            if let Some(version) = candidate
                .strip_prefix(&format!("{root}/"))
                .and_then(|name| name.strip_suffix("/manifest.json"))
                && !version.contains('/')
            {
                versions.insert(contracts::version(version)?, candidate.clone());
            }
        }
        let current_key = versions
            .get(&current)
            .context("latest references a missing immutable manifest")?;
        retained.insert(current_key.clone());
        if let Some((_, previous)) = versions.range(..current).next_back() {
            retained.insert(previous.clone());
        }
    }

    for key in &retained {
        let document = read(key)?;
        for file in document["files"]
            .as_array()
            .context("retained manifest files missing")?
        {
            for chunk in file["chunks"]
                .as_array()
                .context("retained file chunks missing")?
            {
                let hash = chunk["sha256"].as_str().context("chunk digest missing")?;
                ensure!(
                    hash.len() == 64
                        && hash
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                    "invalid retained chunk hash"
                );
                let blob = format!("v1/blobs/sha256/{hash}");
                ensure!(
                    inventory.contains_key(&blob),
                    "retained chunk is missing: {blob}"
                );
                referenced.insert(blob);
            }
        }
    }

    let cutoff = Utc::now() - Duration::days(days.into());
    let mut removed = Vec::new();
    for (key, object) in &inventory {
        let release = roots
            .iter()
            .any(|root| key.starts_with(&format!("{root}/")))
            && key.ends_with("/manifest.json");
        let blob = key.starts_with("v1/blobs/sha256/");
        if (release && !retained.contains(key)) || (blob && !referenced.contains(key)) {
            let modified = DateTime::parse_from_rfc3339(
                object["LastModified"]
                    .as_str()
                    .context("inventory LastModified missing")?,
            )?;
            if modified <= cutoff {
                removed.push(key.clone());
            }
        }
    }
    removed.sort_by_key(|key| (key.starts_with("v1/blobs/"), key.clone()));
    Ok(removed)
}

/// Clean remote objects only after the complete retention plan succeeds
pub fn remote(store: &impl ObjectStore, days: u32, dry_run: bool) -> Result<Vec<String>> {
    let removed = plan(&store.inventory()?, |key| store.read_json(key), days)?;
    if !dry_run {
        for key in &removed {
            check_cancelled()?;
            store.delete(key)?;
        }
    }
    Ok(removed)
}

/// Apply the same retention rules to a prepared local publication tree
pub fn local(output: &Path, days: u32, dry_run: bool) -> Result<Vec<PathBuf>> {
    let storage = pandd_local_storage::Root::new(output)?;
    let root = output.canonicalize()?;
    let mut inventory = Vec::new();
    for path in files::regular_files(&root)? {
        let modified: DateTime<Utc> = path.metadata()?.modified()?.into();
        inventory.push(
            json!({"Key": files::object_key(&path, &root)?, "LastModified": modified.to_rfc3339()}),
        );
    }
    let keys = plan(&inventory, |key| files::read_json(&root.join(key)), days)?;
    let mut removed = Vec::new();
    for key in keys {
        let manifest = key.ends_with("/manifest.json");
        let path = root.join(&key);
        let target = if manifest {
            path.parent().context("release parent")?.to_owned()
        } else {
            path
        };
        storage.check_tree(target.strip_prefix(&root)?)?;
        removed.push(target);
    }
    if !dry_run {
        check_cancelled()?;
        let relative = removed
            .iter()
            .map(|target| target.strip_prefix(&root).map(Path::to_path_buf))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for target in relative {
            check_cancelled()?;
            storage.remove_all(&[target])?;
        }
    }
    Ok(removed)
}
