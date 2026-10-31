use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::wasm_bindgen::JsValue;
use worker::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    expected_version: u64,
    operation_id: String,
    data: Presentation,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Presentation {
    title: String,
    r#abstract: String,
}

/// 申請原稿と公開済み発表のタイトル・概要を同じトランザクションで変更する
///
/// # 引数
/// - `req`: タイトル・概要変更リクエスト
/// - `db`: 申請と公開版を保存するデータベース
/// - `id`: 対象の申請ID
/// - `actor`: 認証済みの運営IDまたは本人メール
/// - `operator`: 運営からの操作か
/// - `request_id`: エラー応答の追跡ID
///
/// # 戻り値
/// 更新済み申請または入力・権限・状態・版競合のエラー応答
///
/// # エラー
/// データベース処理または応答構成に失敗した場合
pub async fn save(
    req: &mut Request,
    db: &D1Database,
    id: &str,
    actor: &str,
    operator: bool,
    request_id: &str,
) -> Result<Response> {
    let input: Input = match crate::input::json(req).await {
        Ok(input) => input,
        Err(_) => return failure("VALIDATION", 422, request_id),
    };
    if input.expected_version == 0
        || input.operation_id.trim().is_empty()
        || input.data.title.trim().is_empty()
        || input.data.r#abstract.trim().is_empty()
    {
        return failure("VALIDATION", 422, request_id);
    }

    // 認証領域ごとの既存receiptで再送と別内容の使い回しを判定する
    let scope = if operator { "operator" } else { "applicant" };
    let hash = Sha256::digest(serde_json::to_vec(&json!([
        "presentation",
        id,
        input.expected_version,
        input.data.title,
        input.data.r#abstract
    ]))?)
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect::<String>();
    if let Some(response) =
        crate::receipts::response(db, scope, actor, &input.operation_id, &hash, request_id).await?
    {
        return Ok(response);
    }
    let owner = if operator {
        JsValue::NULL
    } else {
        actor.into()
    };
    let rows = db.prepare("SELECT a.dto,e.state FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1 AND (?2 IS NULL OR a.email=?2)")
        .bind(&[id.into(), owner.clone()])?.all().await?.results::<Value>()?;
    let Some(row) = rows.first() else {
        return failure("NOT_FOUND", 404, request_id);
    };
    let dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    if crate::applicant::expired(&dto, crate::lifecycle::now(db).await?) {
        return failure("RETENTION_EXPIRED", 410, request_id);
    }
    if row["state"] == "cancelled"
        || dto["withdrawal"] == "confirmed"
        || matches!(dto["review"].as_str(), Some("rejected" | "withdrawn"))
    {
        return failure("INVALID_TRANSITION", 409, request_id);
    }

    // 保存時のJSONを部分更新し、同時に変更された時間割や審査原稿を保持する
    db.batch(vec![
        db.prepare(include_str!("presentation.sql")).bind(&[
            input.data.title.trim().into(), id.into(), (input.expected_version as f64).into(),
            input.operation_id.clone().into(), hash.clone().into(),
            if operator { actor.into() } else { JsValue::NULL }, owner,
            input.data.r#abstract.trim().into(),
        ])?,
        db.prepare("UPDATE lt_public_talks SET dto=(SELECT json_extract(a.dto,'$.published') FROM lt_applications a WHERE a.id=lt_public_talks.id) WHERE id=?1 AND EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=?1 AND a.operation_id=?2 AND a.payload_hash=?3 AND json_type(a.dto,'$.published')='object')")
            .bind(&[id.into(), input.operation_id.clone().into(), hash.clone().into()])?,
        db.prepare("INSERT INTO lt_applicant_operations(actor,operation_id,payload_hash,application_id,result,expires) SELECT email,operation_id,payload_hash,id,dto,(SELECT private_expires FROM lt_events WHERE id=event_id) FROM lt_applications WHERE id=?1 AND operation_id=?2 AND actor_id IS NULL ON CONFLICT DO NOTHING")
            .bind(&[id.into(), input.operation_id.clone().into()])?,
    ]).await?;
    if let Some(response) =
        crate::receipts::response(db, scope, actor, &input.operation_id, &hash, request_id).await?
    {
        return Ok(response);
    }
    failure("VERSION_CONFLICT", 409, request_id)
}

/// タイトル・概要変更の契約エラーを生成する
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
