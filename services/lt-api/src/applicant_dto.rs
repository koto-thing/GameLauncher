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
}
#[derive(Deserialize, Serialize)]
struct Content {
    title: String,
    #[serde(rename = "abstract")]
    abstract_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    speakers: Vec<Speaker>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Application {
    id: String,
    event_id: String,
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
    let mut dto: Application = serde_json::from_value(value.clone()).ok()?;
    if let Some(published) = &dto.published {
        dto.published = Some(crate::public_dto::validate(published, true)?);
    }
    serde_json::to_value(dto).ok()
}
