use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SessionInfo {
    field: String,
    related_fields: Vec<String>,
    keywords: Vec<String>,
    platforms: Vec<String>,
    difficulty: String,
    prerequisites: String,
    takeaways: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpeakerLink {
    label: String,
    url: String,
}

/// 配列の件数・文字数・重複を検証する
/// 引数: 配列、件数上限、文字数上限
/// 戻り値: 妥当性
fn strings(values: &[String], max: usize, length: usize) -> bool {
    values.len() <= max
        && values.iter().enumerate().all(|(i, s)| {
            !s.trim().is_empty() && s.chars().count() <= length && !values[..i].contains(s)
        })
}

/// セッション情報の選択肢と長さを検証する
/// 引数: セッション情報
/// 戻り値: 妥当性
fn valid_session(s: &SessionInfo) -> bool {
    ["programming", "sound", "graphics"].contains(&s.field.as_str())
        && ["easy", "normal", "hard"].contains(&s.difficulty.as_str())
        && strings(&s.related_fields, 7, 3)
        && s.related_fields
            .iter()
            .all(|v| ["ENG", "PRD", "VA", "GD", "SND", "BP", "AC"].contains(&v.as_str()))
        && strings(&s.keywords, 10, 40)
        && strings(&s.platforms, 10, 60)
        && s.prerequisites.chars().count() <= 3000
        && s.takeaways.chars().count() <= 3000
}

/// 公開リンクをHTTP(S)に制限する
/// 引数: リンク
/// 戻り値: 妥当性
fn valid_link(link: &SpeakerLink) -> bool {
    !link.label.trim().is_empty()
        && link.label.chars().count() <= 40
        && link.url.len() <= 2048
        && worker::Url::parse(&link.url).is_ok_and(|u| {
            ["http", "https"].contains(&u.scheme())
                && u.host_str().is_some()
                && u.username().is_empty()
                && u.password().is_none()
        })
}

/// 申請と公開版の追加情報を同じ規則で検証する
/// 引数: 発表内容
/// 戻り値: 妥当性
pub(crate) fn valid(value: &Value) -> bool {
    let session_ok = value.get("session").is_none_or(|s| {
        serde_json::from_value::<SessionInfo>(s.clone()).is_ok_and(|s| valid_session(&s))
    });
    session_ok
        && value["speakers"].as_array().is_some_and(|speakers| {
            speakers.iter().all(|s| {
                s.get("links").is_none_or(|v| {
                    serde_json::from_value::<Vec<SpeakerLink>>(v.clone())
                        .is_ok_and(|links| links.len() <= 5 && links.iter().all(valid_link))
                })
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn metadata_and_links_are_validated() {
        let mut value = json!({"speakers":[{"displayName":"発表者","links":[{"label":"GitHub","url":"https://github.com/example"}]}],"session":{"field":"programming","relatedFields":["ENG","GD"],"keywords":["Unity"],"platforms":["PC"],"difficulty":"easy","prerequisites":"なし","takeaways":"制作手順"}});
        assert!(valid(&value));
        for url in [
            "javascript:alert(1)",
            "data:text/html,test",
            "https://user:pass@example.com",
        ] {
            value["speakers"][0]["links"][0]["url"] = json!(url);
            assert!(!valid(&value));
        }
        value["speakers"][0]["links"] = json!([]);
        value["session"]["difficulty"] = json!("unknown");
        assert!(!valid(&value));
        value["session"] = Value::Null;
        assert!(!valid(&value));
    }
}
