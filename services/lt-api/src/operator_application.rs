use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    expected_version: u64,
    operation_id: String,
    data: Data,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Data {
    content: Value,
    material_url: String,
}

/// 運営による申請内容の編集を原稿と既存の公開版へ原子的に反映する
///
/// # 引数
/// - `req`: 編集内容と排他制御情報を持つリクエスト
/// - `db`: 申請と公開版を保存するデータベース
/// - `id`: 対象の申請ID
/// - `actor`: 管理者・幹部として認証済みの運営者ID
/// - `request_id`: 応答に含める追跡ID
///
/// # 戻り値
/// 更新済み申請または入力・状態・版競合のエラー応答
///
/// # エラー
/// データベース処理または応答の構成に失敗した場合
pub async fn save(
    req: &mut Request,
    db: &D1Database,
    id: &str,
    actor: &str,
    request_id: &str,
) -> Result<Response> {
    let input: Input = match crate::input::json(req).await {
        Ok(input) => input,
        Err(_) => return failure("VALIDATION", 422, request_id),
    };
    if input.expected_version == 0
        || input.operation_id.trim().is_empty()
        || !crate::applicant::content(&input.data.content, &json!(input.data.material_url))
    {
        return failure("VALIDATION", 422, request_id);
    }

    // 確定済み操作の再送では版を増やさず、元の結果を返す
    let hash = Sha256::digest(serde_json::to_vec(&json!([
        "applicationEdit",
        id,
        input.expected_version,
        input.data.content,
        input.data.material_url
    ]))?)
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect::<String>();
    if let Some(response) = crate::receipts::response(
        db,
        "operator",
        actor,
        &input.operation_id,
        &hash,
        request_id,
    )
    .await?
    {
        return Ok(response);
    }
    let row = db.prepare("SELECT a.dto,e.state FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1")
        .bind(&[id.into()])?.first::<Value>(None).await?;
    let Some(row) = row else {
        return failure("NOT_FOUND", 404, request_id);
    };
    let mut dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    if crate::applicant::expired(&dto, crate::lifecycle::now(db).await?) {
        return failure("RETENTION_EXPIRED", 410, request_id);
    }
    if dto["version"] != input.expected_version {
        return failure("VERSION_CONFLICT", 409, request_id);
    }
    if row["state"] == "cancelled"
        || dto["withdrawal"] == "confirmed"
        || matches!(dto["review"].as_str(), Some("rejected" | "withdrawn"))
    {
        return failure("INVALID_TRANSITION", 409, request_id);
    }

    // 公開済みの場合だけ内容を置換し、削除された任意項目も公開版から除く
    dto["content"] = input.data.content.clone();
    if dto["materialUrl"] != input.data.material_url {
        dto["materialReviewedUrl"] = json!("");
    }
    dto["materialUrl"] = json!(input.data.material_url);
    dto["version"] = json!(input.expected_version + 1);
    if dto["published"].is_object() {
        let mut published = input.data.content;
        for key in ["id", "eventId", "startsAt", "endsAt", "cancelled"] {
            published[key] = dto["published"][key].clone();
        }
        published["version"] = dto["version"].clone();
        if crate::public_dto::validate(&published, true).is_none() {
            return failure("VALIDATION", 422, request_id);
        }
        dto["published"] = published;
    }

    // 時間割だけが並行更新された場合は保存直前の発表時刻を維持する
    db.batch(vec![
        db.prepare(include_str!("operator_application.sql")).bind(&[
            dto.to_string().into(), input.operation_id.clone().into(), hash.clone().into(),
            actor.into(), id.into(), (input.expected_version as f64).into(),
        ])?,
        db.prepare("UPDATE lt_public_talks SET dto=(SELECT json_extract(a.dto,'$.published') FROM lt_applications a WHERE a.id=?1) WHERE id=?1 AND EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=?1 AND a.actor_id=?2 AND a.operation_id=?3 AND a.payload_hash=?4 AND a.version=?5 AND json_type(a.dto,'$.published')='object')")
            .bind(&[id.into(), actor.into(), input.operation_id.clone().into(), hash.clone().into(), ((input.expected_version+1) as f64).into()])?,
    ]).await?;
    if let Some(response) = crate::receipts::response(
        db,
        "operator",
        actor,
        &input.operation_id,
        &hash,
        request_id,
    )
    .await?
    {
        return Ok(response);
    }
    failure("VERSION_CONFLICT", 409, request_id)
}

/// 申請編集の契約エラーを生成する
///
/// # 引数
/// - `code`: エラーコード
/// - `status`: HTTPステータス
/// - `request_id`: 追跡ID
///
/// # 戻り値
/// 指定ステータスのJSON応答
///
/// # エラー
/// JSON応答の構成に失敗した場合
fn failure(code: &str, status: u16, request_id: &str) -> Result<Response> {
    Ok(
        Response::from_json(&json!({"error":{"code":code,"requestId":request_id}}))?
            .with_status(status),
    )
}
