use anyhow::{Context, Result, bail, ensure};
use regex::Regex;
use serde_json::Value;
use std::{collections::HashMap, sync::OnceLock};

/// リポジトリ内のスキーマをネットワーク参照なしで一度だけコンパイルする
///
/// # 戻り値
///
/// スキーマ名をキーとする初期化済みバリデータの共有参照
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

/// 日付と URI の形式を含めて公開文書を検証する
///
/// # 引数
///
/// * `document` - 検証または保存する JSON 文書
/// * `schema` - リポジトリ内のスキーマファイル名
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
pub fn validate(document: &Value, schema: &str) -> Result<()> {
    let validator = validators()
        .get(schema)
        .context("unknown publication schema")?;
    if let Err(error) = validator.validate(document) {
        bail!("{schema}: {error}");
    }
    Ok(())
}

/// ファイル操作の前に非正規形や環境依存の相対パスを拒否する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 検証済みの入力パス
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

/// ビルドのルートを表す作業ディレクトリを許可する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 検証済みの作業ディレクトリ
pub fn working_directory(path: &str) -> Result<&str> {
    if path == "." {
        Ok(path)
    } else {
        relative_path(path)
    }
}

/// 公開オブジェクトのキーに使う言語タグを検証する
///
/// # 引数
///
/// * `value` - 検証対象の文字列
///
/// # 戻り値
///
/// 検証済みの言語タグ
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

/// 配信契約で定めたバージョン形式を解析する
///
/// # 引数
///
/// * `value` - 検証対象の文字列
///
/// # 戻り値
///
/// メジャー・マイナー・パッチの3要素
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

/// 整数のみを含む署名対象の JSON をキー順に並べて UTF-8 に変換する
///
/// # 引数
///
/// * `document` - 検証または保存する JSON 文書
///
/// # 戻り値
///
/// キー順を正規化した UTF-8 JSON のバイト列
pub fn canonical_json(document: &Value) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(document)?)
}
