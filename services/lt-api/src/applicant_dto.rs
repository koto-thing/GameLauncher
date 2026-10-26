use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Speaker {
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    affiliation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    links: Option<Vec<crate::session_info::SpeakerLink>>,
}
#[derive(Deserialize, Serialize)]
struct Content {
    title: String,
    #[serde(rename = "abstract")]
    abstract_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    speakers: Vec<Speaker>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session: Option<crate::session_info::SessionInfo>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Application {
    id: String,
    event_id: String,
    event_state: String,
    event_cancelled_at: Option<String>,
    version: u64,
    content: Content,
    material_url: String,
    representative_email: String,
    review: String,
    withdrawal: String,
    first_submitted_at: String,
    ever_approved: bool,
    slot_reserved: bool,
    retention_expires_at: Option<String>,
    published: Option<Value>,
}

/// 本人専用 DTO から運営項目の誤混入を除去する
/// 引数: 保存された申請
/// 戻り値: 型付き許可項目だけの DTO または None
pub fn sanitize(value: &Value) -> Option<Value> {
    if !crate::session_info::valid(&value["content"]) {
        return None;
    }
    let mut dto: Application = serde_json::from_value(value.clone()).ok()?;
    if let Some(published) = &dto.published {
        dto.published = Some(crate::public_dto::validate(published, true)?);
    }
    serde_json::to_value(dto).ok()
}

/// 運営DTOも本人の具体型から構築し、保存メモだけを加える
/// 引数: 運営用申請
/// 戻り値: 許可項目だけの運営DTO
pub fn operator(value: &Value) -> Option<Value> {
    let mut result = sanitize(value)?;
    result["operatorNote"] = Value::String(
        value
            .get("operatorNote")
            .map_or(Some(""), Value::as_str)?
            .to_owned(),
    );
    Some(result)
}
