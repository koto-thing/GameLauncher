use anyhow::{Context, Result, bail, ensure};
use regex::Regex;
use serde_json::Value;
use std::{collections::HashMap, sync::OnceLock};

/// Compile the checked-in schemas once without network resolution
fn validators() -> &'static HashMap<&'static str, jsonschema::Validator> {
    static VALIDATORS: OnceLock<HashMap<&str, jsonschema::Validator>> = OnceLock::new();
    VALIDATORS.get_or_init(|| {
        macro_rules! schema {
            ($name:literal) => {
                (
                    $name,
                    include_str!(concat!("../../contracts/schemas/", $name)),
                )
            };
        }

        [
            schema!("game-release-source.schema.json"),
            schema!("game-release.schema.json"),
            schema!("catalog.schema.json"),
            schema!("announcements-source.schema.json"),
            schema!("announcements.schema.json"),
            schema!("launcher-release-source.schema.json"),
            schema!("launcher-release.schema.json"),
            schema!("launcher-changelog.schema.json"),
        ]
        .into_iter()
        .map(|(name, source)| {
            let schema: Value = serde_json::from_str(source).expect("checked-in JSON schema");
            let validator = jsonschema::draft202012::options()
                .should_validate_formats(true)
                .build(&schema)
                .expect("valid checked-in schema");
            (name, validator)
        })
        .collect()
    })
}

/// Validate a public document including date and URI formats
pub fn validate(document: &Value, schema: &str) -> Result<()> {
    let validator = validators()
        .get(schema)
        .context("unknown publication schema")?;
    if let Err(error) = validator.validate(document) {
        bail!("{schema}: {error}");
    }
    Ok(())
}

/// Reject noncanonical and platform-dependent paths before filesystem access
pub fn relative_path(path: &str) -> Result<&str> {
    ensure!(
        !path.is_empty() && path.chars().count() <= 240,
        "invalid relative path length"
    );
    ensure!(
        !path.contains(['\\', ':', '\0']),
        "unsafe relative path: {path}"
    );
    ensure!(
        path.split('/').all(|part| !matches!(part, "" | "." | "..")),
        "unsafe relative path: {path}"
    );
    Ok(path)
}

/// Permit the build root as a working directory
pub fn working_directory(path: &str) -> Result<&str> {
    if path == "." {
        Ok(path)
    } else {
        relative_path(path)
    }
}

/// Validate locale names before using them in public object keys
pub fn locale(value: &str) -> Result<&str> {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    ensure!(
        PATTERN
            .get_or_init(|| Regex::new(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$").unwrap())
            .is_match(value),
        "invalid locale tag: {value}"
    );
    Ok(value)
}

/// Parse the exact version format used by the publication contracts
pub fn version(value: &str) -> Result<[u64; 3]> {
    let parts: Vec<_> = value.split('.').collect();
    ensure!(parts.len() == 3, "invalid version: {value}");
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        ensure!(
            !part.is_empty()
                && part.bytes().all(|c| c.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0')),
            "invalid version: {value}"
        );
        result[index] = part.parse()?;
    }
    Ok(result)
}

/// Encode sorted UTF-8 JSON for the integer-only signed release contract
pub fn canonical_json(document: &Value) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(document)?)
}
