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

/// 削除前に全対象を計画し現在版と直前の版を保持する
///
/// # 引数
///
/// * `objects` - キーと更新日時を含むオブジェクト一覧
/// * `read` - キーからマニフェストを読み込む関数
/// * `days` - 未参照オブジェクトの削除までの猶予日数、7日以上
///
/// # 戻り値
///
/// 猶予期間を過ぎた未参照オブジェクトのキー一覧
fn plan(objects: &[Value], read: impl Fn(&str) -> Result<Value>, days: u32) -> Result<Vec<String>> {
    ensure!(
        days >= 7,
        "cleanup grace period must be at least seven days"
    );

    // 配信ツリーをキーで索引化し、最新マニフェストとチャンクを抽出する
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

    // 各 latest が示す現在版とその直前の版を保持対象にする
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

    // 保持対象が参照する全チャンクの存在を確認する
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

    // 保持対象外かつ猶予期間を過ぎたマニフェストとチャンクだけを選ぶ
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

/// 保持計画がすべて成功してからリモートのオブジェクトを整理する
///
/// # 引数
///
/// * `store` - 配信先のオブジェクトストア
/// * `days` - 未参照オブジェクトの削除までの猶予日数、7日以上
/// * `dry_run` - 削除せずに対象一覧のみを返す場合は true
///
/// # 戻り値
///
/// 削除対象のキー一覧、dry_run では実際の削除を省略
pub fn remote(store: &impl ObjectStore, days: u32, dry_run: bool) -> Result<Vec<String>> {
    // 削除操作に入る前に全対象の保持計画を確定する
    let removed = plan(&store.inventory()?, |key| store.read_json(key), days)?;

    // 試行実行では対象一覧だけを返し、ストレージを変更しない
    if !dry_run {
        for key in &removed {
            check_cancelled()?;
            store.delete(key)?;
        }
    }
    Ok(removed)
}

/// ローカルの配信ツリーにも同じ保持規則を適用する
///
/// # 引数
///
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `days` - 未参照オブジェクトの削除までの猶予日数、7日以上
/// * `dry_run` - 削除せずに対象一覧のみを返す場合は true
///
/// # 戻り値
///
/// 削除対象の絶対パス一覧、dry_run では実際の削除を省略
pub fn local(output: &Path, days: u32, dry_run: bool) -> Result<Vec<PathBuf>> {
    // ローカルファイルの更新日時からリモートと同じ形式の一覧を作る
    let storage = pandd_local_storage::Root::new(output)?;
    let root = output.canonicalize()?;
    let mut inventory = Vec::new();
    for path in files::regular_files(&root)? {
        let modified: DateTime<Utc> = path.metadata()?.modified()?.into();
        inventory.push(
            json!({"Key": files::object_key(&path, &root)?, "LastModified": modified.to_rfc3339()}),
        );
    }

    // マニフェストの削除は版全体を対象にし、各ツリーを事前検証する
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

    // 試行実行では対象一覧だけを返し、ストレージを変更しない
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
