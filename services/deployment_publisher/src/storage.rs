use crate::{check_cancelled, files};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{path::Path, process::Command};

pub const IMMUTABLE_CACHE: &str = "public,max-age=31536000,immutable";
pub const POINTER_CACHE: &str = "public,max-age=60,must-revalidate";

/// Isolate object storage operations for local failure and ordering tests
pub trait ObjectStore {
    /// Read integrity metadata or report an explicitly missing object
    fn head(&self, key: &str) -> Result<Option<Value>>;
    /// Write one object with the selected cache policy
    fn put(&self, key: &str, source: &Path, metadata: &Value, immutable: bool) -> Result<()>;
    /// List all objects needed to plan retention
    fn inventory(&self) -> Result<Vec<Value>>;
    /// Read a public manifest as JSON
    fn read_json(&self, key: &str) -> Result<Value>;
    /// Remove one approved cleanup candidate
    fn delete(&self, key: &str) -> Result<()>;
}

pub struct AwsStore {
    pub endpoint: String,
    pub bucket: String,
}

impl AwsStore {
    /// Use the existing AWS CLI credential chain and multipart upload implementation
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

    /// Execute a storage command and preserve actionable CLI diagnostics
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
    /// Treat only explicit object-not-found responses as missing immutable data
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

    /// Upload with deterministic content type, checksum metadata, and cache policy
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

    /// Let AWS CLI paginate the complete object inventory
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

    /// Read a retained manifest before planning any deletion
    fn read_json(&self, key: &str) -> Result<Value> {
        Ok(serde_json::from_slice(&self.execute(&[
            "s3",
            "cp",
            &format!("s3://{}/{key}", self.bucket),
            "-",
            "--no-progress",
        ])?)?)
    }

    /// Delete one previously validated cleanup candidate
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

/// Identify the mutable indexes that must follow immutable upload verification
fn is_pointer(key: &str) -> bool {
    let parts: Vec<_> = key.split('/').collect();
    matches!(parts.last(), Some(&"latest.json" | &"Updates.xml"))
        || parts
            .iter()
            .any(|part| ["catalog", "announcements", "changelog"].contains(part))
}

/// Upload immutable objects first and publish latest pointers last
pub fn upload(output: &Path, store: &impl ObjectStore, phase: Phase) -> Result<()> {
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

    // Honor cancellation before promotion, then finish the ordered pointer writes
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
