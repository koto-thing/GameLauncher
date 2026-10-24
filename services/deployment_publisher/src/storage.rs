use crate::{check_cancelled, files};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{path::Path, process::Command};

pub const IMMUTABLE_CACHE: &str = "public,max-age=31536000,immutable";
pub const POINTER_CACHE: &str = "public,max-age=60,must-revalidate";

/// ストレージ操作を分離して障害と公開順序をローカルで検証可能にする
pub trait ObjectStore {
    /// 整合性メタデータを取得し対象が存在しない場合は None を返す
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    ///
    /// # 戻り値
    ///
    /// 存在する場合は整合性メタデータ、存在しない場合は None
    fn head(&self, key: &str) -> Result<Option<Value>>;
    /// 指定されたキャッシュ方針でオブジェクトを書き込む
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    /// * `source` - 入力ファイルまたはディレクトリのパス
    /// * `metadata` - サイズ、SHA-256、Content-Type を含むメタデータ
    /// * `immutable` - 不変オブジェクト用のキャッシュ方針を選ぶ場合は true
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    fn put(&self, key: &str, source: &Path, metadata: &Value, immutable: bool) -> Result<()>;
    /// 保持計画に必要な全オブジェクトを列挙する
    ///
    /// # 戻り値
    ///
    /// キーと更新日時を含むオブジェクト一覧
    fn inventory(&self) -> Result<Vec<Value>>;
    /// 公開マニフェストを JSON として読み込む
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    ///
    /// # 戻り値
    ///
    /// 読み込んだ JSON 文書
    fn read_json(&self, key: &str) -> Result<Value>;
    /// 整理計画で承認されたオブジェクトを削除する
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    fn delete(&self, key: &str) -> Result<()>;
}

pub struct AwsStore {
    pub endpoint: String,
    pub bucket: String,
}

impl AwsStore {
    /// 既存の AWS CLI の認証情報探索と multipart 転送を利用する
    ///
    /// # 引数
    ///
    /// * `args` - AWS CLI へ渡す引数
    ///
    /// # 戻り値
    ///
    /// 認証と再試行の設定を適用した AWS CLI コマンド
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new("aws");
        command
            .args(args)
            .args(["--endpoint-url", &self.endpoint])
            .env("AWS_PAGER", "");
        command
            .env("AWS_MAX_ATTEMPTS", pandd_transfer::MAX_ATTEMPTS.to_string())
            .env("AWS_RETRY_MODE", "standard");
        command
    }

    /// ストレージコマンドを実行し診断に使える CLI のエラーを保持する
    ///
    /// # 引数
    ///
    /// * `args` - AWS CLI へ渡す引数
    ///
    /// # 戻り値
    ///
    /// 正常終了した AWS CLI の標準出力
    fn execute(&self, args: &[&str]) -> Result<Vec<u8>> {
        let output = pandd_transfer::command_output(&mut self.command(args), check_cancelled)
            .context("AWS CLI storage operation did not complete")?;
        ensure!(
            output.status.success(),
            "AWS CLI failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(output.stdout)
    }
}

impl ObjectStore for AwsStore {
    /// 明示的な未検出応答だけを不変オブジェクトの欠落として扱う
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    ///
    /// # 戻り値
    ///
    /// 存在する場合は整合性メタデータ、存在しない場合は None
    fn head(&self, key: &str) -> Result<Option<Value>> {
        let output = pandd_transfer::command_output(
            &mut self.command(&[
                "s3api",
                "head-object",
                "--bucket",
                &self.bucket,
                "--key",
                key,
                "--query",
                "{size:ContentLength,sha256:Metadata.sha256,contentType:ContentType}",
                "--output",
                "json",
            ]),
            check_cancelled,
        )?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if error.contains("(404)")
                || error.contains("(NoSuchKey)")
                || error.contains("(NotFound)")
            {
                return Ok(None);
            }
            bail!("cannot inspect remote object {key}: {error}");
        }
        Ok(Some(serde_json::from_slice(&output.stdout)?))
    }

    /// Content-Type、ハッシュのメタデータ、キャッシュ方針を指定して転送する
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    /// * `source` - 入力ファイルまたはディレクトリのパス
    /// * `metadata` - サイズ、SHA-256、Content-Type を含むメタデータ
    /// * `immutable` - 不変オブジェクト用のキャッシュ方針を選ぶ場合は true
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    fn put(&self, key: &str, source: &Path, metadata: &Value, immutable: bool) -> Result<()> {
        self.execute(&[
            "s3",
            "cp",
            source.to_str().context("non-UTF-8 source")?,
            &format!("s3://{}/{key}", self.bucket),
            "--cache-control",
            if immutable {
                IMMUTABLE_CACHE
            } else {
                POINTER_CACHE
            },
            "--content-type",
            metadata["contentType"].as_str().context("content type")?,
            "--metadata",
            &format!("sha256={}", metadata["sha256"].as_str().context("digest")?),
            "--no-progress",
        ])?;
        Ok(())
    }

    /// AWS CLI のページングで全オブジェクトを列挙する
    ///
    /// # 戻り値
    ///
    /// キーと更新日時を含むオブジェクト一覧
    fn inventory(&self) -> Result<Vec<Value>> {
        let document: Value = serde_json::from_slice(&self.execute(&[
            "s3api",
            "list-objects-v2",
            "--bucket",
            &self.bucket,
            "--prefix",
            "v1/",
            "--output",
            "json",
        ])?)?;
        Ok(document
            .get("Contents")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    /// 削除計画の作成前に保持対象のマニフェストを読み込む
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    ///
    /// # 戻り値
    ///
    /// 読み込んだ JSON 文書
    fn read_json(&self, key: &str) -> Result<Value> {
        Ok(serde_json::from_slice(&self.execute(&[
            "s3",
            "cp",
            &format!("s3://{}/{key}", self.bucket),
            "-",
            "--no-progress",
        ])?)?)
    }

    /// 事前検証済みの整理対象を削除する
    ///
    /// # 引数
    ///
    /// * `key` - オブジェクトストレージ内のキー
    ///
    /// # 戻り値
    ///
    /// 処理が完了した場合は Ok(())
    fn delete(&self, key: &str) -> Result<()> {
        self.execute(&[
            "s3api",
            "delete-object",
            "--bucket",
            &self.bucket,
            "--key",
            key,
        ])?;
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    All,
    Immutable,
    Pointers,
}

/// 不変オブジェクトの検証後に更新する公開ポインタを識別する
///
/// # 引数
///
/// * `key` - オブジェクトストレージ内のキー
///
/// # 戻り値
///
/// 不変オブジェクトの検証後に更新する公開ポインタなら true
fn is_pointer(key: &str) -> bool {
    let parts: Vec<_> = key.split('/').collect();
    matches!(parts.last(), Some(&"latest.json" | &"Updates.xml"))
        || parts
            .iter()
            .any(|part| ["catalog", "announcements", "changelog"].contains(part))
}

/// 不変オブジェクトを先に転送し最後に公開ポインタを更新する
///
/// # 引数
///
/// * `output` - 配信ファイルを配置するローカルディレクトリ
/// * `store` - 配信先のオブジェクトストア
/// * `phase` - 不変オブジェクトと公開ポインタのアップロード範囲
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn upload(output: &Path, store: &impl ObjectStore, phase: Phase) -> Result<()> {
    // 全ファイルの整合性メタデータを生成して公開順に並べる
    let mut objects = Vec::new();
    for path in files::regular_files(output)? {
        check_cancelled()?;
        let key = files::object_key(&path, output)?;
        let metadata = json!({"size": path.metadata()?.len(), "sha256": pandd_file_integrity::hash_file(&path)?,
            "contentType": files::content_type(&path)});
        objects.push((key, path, metadata));
    }
    objects
        .sort_by_key(|(key, _, _)| (is_pointer(key), key.ends_with("/latest.json"), key.clone()));

    // 公開ポインタを更新する前に全不変オブジェクトの内容を確認する
    for (key, path, metadata) in objects.iter().filter(|(key, _, _)| !is_pointer(key)) {
        check_cancelled()?;
        let existing = store.head(key)?;
        if phase == Phase::Pointers {
            ensure!(
                existing.as_ref() == Some(metadata),
                "immutable object is missing or mismatched: {key}"
            );
            continue;
        }
        if let Some(existing) = existing {
            ensure!(
                &existing == metadata,
                "refusing to overwrite immutable object: {key}"
            );
        } else {
            store.put(key, path, metadata, true)?;
            ensure!(
                store.head(key)?.as_ref() == Some(metadata),
                "uploaded object metadata mismatch: {key}"
            );
        }
    }
    if phase == Phase::Immutable {
        return Ok(());
    }

    // 公開ポインタの更新前にキャンセルを確認してから決められた順序で書き込む
    check_cancelled()?;
    for (key, path, metadata) in objects.iter().filter(|(key, _, _)| is_pointer(key)) {
        store.put(key, path, metadata, false)?;
        ensure!(
            store.head(key)?.as_ref() == Some(metadata),
            "uploaded object metadata mismatch: {key}"
        );
    }
    Ok(())
}
