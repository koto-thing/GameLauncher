use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Speaker {
    display_name: String,
    #[serde(
        default,
        deserialize_with = "optional_text",
        skip_serializing_if = "Option::is_none"
    )]
    affiliation: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_text",
        skip_serializing_if = "Option::is_none"
    )]
    profile: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Talk,
    Transition,
    Opening,
    Break,
    Closing,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Block {
    id: String,
    kind: Kind,
    #[serde(
        default,
        deserialize_with = "optional_text",
        skip_serializing_if = "Option::is_none"
    )]
    talk_id: Option<String>,
    starts_at: String,
    ends_at: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Recruitment {
    Upcoming,
    Open,
    Full,
    Closed,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Event {
    id: String,
    version: u64,
    title: String,
    venue: String,
    guidance: String,
    starts_at: String,
    ends_at: String,
    time_zone: String,
    recruitment: Recruitment,
    schedule: Vec<Block>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Talk {
    id: String,
    event_id: String,
    version: u64,
    title: String,
    #[serde(rename = "abstract")]
    abstract_text: String,
    #[serde(
        default,
        deserialize_with = "optional_text",
        skip_serializing_if = "Option::is_none"
    )]
    description: Option<String>,
    speakers: Vec<Speaker>,
    starts_at: String,
    ends_at: String,
    cancelled: bool,
}

/// 公開版を具体型で検証し、型不正や必須項目欠落を閉じる
/// 引数: 保存版、発表フラグ
/// 戻り値: 正しい公開 DTO または None
pub fn validate(value: &Value, talk: bool) -> Option<Value> {
    // clone は deserialize 前だけに限定し、未知キーも拒否する
    if talk {
        let dto: Talk = serde_json::from_value(value.clone()).ok()?;
        if dto.version == 0
            || [&dto.id, &dto.event_id, &dto.title, &dto.abstract_text]
                .iter()
                .any(|s| s.is_empty())
            || dto.speakers.is_empty()
            || !instant(&dto.starts_at)
            || !instant(&dto.ends_at)
            || dto.starts_at >= dto.ends_at
            || dto.description.as_ref().is_some_and(|s| s.is_empty())
            || dto.speakers.iter().any(|s| {
                s.display_name.is_empty()
                    || s.affiliation.as_ref().is_some_and(|s| s.is_empty())
                    || s.profile.as_ref().is_some_and(|s| s.is_empty())
            })
        {
            return None;
        }
        serde_json::to_value(dto).ok()
    } else {
        let dto: Event = serde_json::from_value(value.clone()).ok()?;
        if dto.version == 0
            || [
                &dto.id,
                &dto.title,
                &dto.venue,
                &dto.guidance,
                &dto.time_zone,
            ]
            .iter()
            .any(|s| s.is_empty())
            || !instant(&dto.starts_at)
            || !instant(&dto.ends_at)
            || dto.starts_at >= dto.ends_at
            || dto.schedule.iter().any(|b| {
                b.id.is_empty()
                    || !instant(&b.starts_at)
                    || !instant(&b.ends_at)
                    || b.starts_at >= b.ends_at
                    || matches!(b.kind, Kind::Talk)
                        && b.talk_id.as_ref().is_none_or(|s| s.is_empty())
            })
        {
            return None;
        }
        serde_json::to_value(dto).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_values_fail_closed() {
        assert!(
            validate(
                &serde_json::json!({"title":{"representativeEmail":"private"}}),
                false
            )
            .is_none()
        );
        assert!(validate(&serde_json::json!({}), true).is_none());
    }
}

/// 正規化された UTC 時刻を検証する
/// 引数: 時刻文字列
/// 戻り値: 契約どおりか
fn instant(value: &str) -> bool {
    value.len() == 24
        && value.ends_with('Z')
        && chrono::DateTime::parse_from_rfc3339(value).is_ok()
        && value.as_bytes().get(19) == Some(&b'.')
}

/// 明示 null を許可せず省略可能な文字列を読む
/// 引数: デシリアライザー
/// 戻り値: 存在する文字列
fn optional_text<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}
