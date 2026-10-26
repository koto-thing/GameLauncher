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
///
/// # 引数
///
/// * `values` - 検証する文字列の配列
/// * `max` - 配列の最大件数
/// * `length` - 各文字列の最大文字数
///
/// # 戻り値
///
/// 空白のみの値や重複がなく、件数と文字数が上限以内なら true
fn strings(values: &[String], max: usize, length: usize) -> bool {
    values.len() <= max
        && values.iter().enumerate().all(|(i, s)| {
            !s.trim().is_empty() && s.chars().count() <= length && !values[..i].contains(s)
        })
}

/// セッション情報の選択肢と長さを検証する
///
/// # 引数
///
/// * `s` - 分野・難易度・キーワードなどのセッション情報
///
/// # 戻り値
///
/// 選択肢と件数・文字数の制限を満たす場合は true
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
///
/// # 引数
///
/// * `link` - 表示名と公開先 URL を持つ登壇者リンク
///
/// # 戻り値
///
/// 長さの制限を満たし、認証情報を含まない HTTP(S) URL の場合は true
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
///
/// # 引数
///
/// * `value` - セッション情報と登壇者の公開リンクを含む発表内容
///
/// # 戻り値
///
/// 任意の追加情報が省略されているか、すべて有効な場合は true
pub(crate) fn valid(value: &Value) -> bool {
    // セッション情報は省略を許可し、指定時は型と選択肢を検証する
    let session_ok = value.get("session").is_none_or(|s| {
        serde_json::from_value::<SessionInfo>(s.clone()).is_ok_and(|s| valid_session(&s))
    });

    // 登壇者ごとのリンク件数と公開 URL の条件を検証する
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
