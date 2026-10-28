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
    data: Data,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Data {
    material_url: String,
}

/// 資料の提出または運営による確認を申請の版と所有者を照合して確定する
///
/// # 引数
/// - `req`: 資料URLと更新対象の版を持つリクエスト
/// - `db`: 申請を保存するデータベース
/// - `id`: 対象申請のID
/// - `actor`: 本人のメールアドレスまたは運営者ID
/// - `operator`: 運営による確認ならtrue
/// - `request_id`: エラー追跡用ID
///
/// # 戻り値
/// 更新済み申請または契約エラー応答
///
/// # エラー
/// データベースの読取・更新に失敗した場合
pub async fn save(
    req: &mut Request,
    db: &D1Database,
    id: &str,
    actor: &str,
    operator: bool,
    request_id: &str,
) -> Result<Response> {
    let error = |code: &str, status| {
        Response::from_json(&json!({"error":{"code":code,"requestId":request_id}}))
            .map(|r| r.with_status(status))
    };
    let raw: Value = match crate::input::json(req).await {
        Ok(value) => value,
        Err(_) => return error("VALIDATION", 422),
    };
    let input: Input = match serde_json::from_value(raw.clone()) {
        Ok(value) => value,
        Err(_) => return error("VALIDATION", 422),
    };
    if input.expected_version == 0
        || input.operation_id.is_empty()
        || !valid_url(&input.data.material_url)
        || (operator && input.data.material_url.is_empty())
    {
        return error("VALIDATION", 422);
    }

    // 他人の申請や保持期限後の資料へはアクセスさせない
    let row = db.prepare("SELECT a.dto,a.email,e.state,e.private_expires FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1")
        .bind(&[id.into()])?.first::<Value>(None).await?;
    let Some(row) = row else {
        return error("NOT_FOUND", 404);
    };
    if !operator && row["email"] != actor {
        return error("NOT_FOUND", 404);
    }
    let now = crate::lifecycle::now(db).await?;
    if row["private_expires"]
        .as_f64()
        .is_some_and(|expires| expires <= now)
    {
        return error("RETENTION_EXPIRED", 410);
    }
    let dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    if crate::applicant::expired(&dto, now) {
        return error("RETENTION_EXPIRED", 410);
    }
    let scope = if operator { "operator" } else { "applicant" };
    let hash = Sha256::digest(format!("{id}:material:{operator}:{raw}").as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if let Some(response) =
        crate::receipts::response(db, scope, actor, &input.operation_id, &hash, request_id).await?
    {
        return Ok(response);
    }
    if dto["version"] != input.expected_version {
        return error("VERSION_CONFLICT", 409);
    }
    if !["scheduled", "started"].contains(&row["state"].as_str().unwrap_or(""))
        || ["rejected", "withdrawn"].contains(&dto["review"].as_str().unwrap_or(""))
        || dto["withdrawal"] != "none"
    {
        return error("INVALID_TRANSITION", 409);
    }
    if operator && dto["materialUrl"] != input.data.material_url {
        return error("VERSION_CONFLICT", 409);
    }

    // JSONの対象項目だけを更新し、同時刻の時間割変更を上書きしない
    let checked = if operator {
        input.data.material_url.as_str()
    } else {
        ""
    };
    let update = db.prepare("UPDATE lt_applications SET version=version+1,dto=json_set(dto,'$.version',version+1,'$.materialUrl',?1,'$.materialReviewedUrl',?2),operation_id=?3,payload_hash=?4,actor_id=?5 WHERE id=?6 AND version=?7 AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',?10/1000.0,'unixepoch')) AND (?8=1 OR email=?9) AND json_extract(dto,'$.withdrawal')='none' AND json_extract(dto,'$.review') NOT IN ('rejected','withdrawn') AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_applications.event_id AND e.state IN ('scheduled','started') AND (e.private_expires IS NULL OR e.private_expires>?10))")
        .bind(&[input.data.material_url.clone().into(),checked.into(),input.operation_id.clone().into(),hash.clone().into(),if operator { actor.into() } else { JsValue::NULL },id.into(),(input.expected_version as f64).into(),(if operator {1.0} else {0.0}).into(),actor.into(),now.into()])?;
    let mut statements = vec![update];
    if !operator {
        statements.push(db.prepare("INSERT INTO lt_applicant_operations(actor,operation_id,payload_hash,application_id,result,expires) SELECT email,operation_id,payload_hash,id,dto,(SELECT private_expires FROM lt_events WHERE id=event_id) FROM lt_applications WHERE id=?1 AND operation_id=?2 AND payload_hash=?3 AND email=?4 ON CONFLICT DO NOTHING").bind(&[id.into(),input.operation_id.clone().into(),hash.clone().into(),actor.into()])?);
    }
    db.batch(statements).await?;
    if let Some(response) =
        crate::receipts::response(db, scope, actor, &input.operation_id, &hash, request_id).await?
    {
        return Ok(response);
    }
    error("VERSION_CONFLICT", 409)
}

/// 未提出または認証情報を含まないHTTP資料URLを検証する
///
/// # 引数
/// - `value`: 提出するURL、未提出なら空文字列
///
/// # 戻り値
/// 許可されたURLまたは未提出ならtrue
pub fn valid_url(value: &str) -> bool {
    value.is_empty()
        || (value.len() <= 2048
            && Url::parse(value).is_ok_and(|url| {
                ["https", "http"].contains(&url.scheme())
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
            }))
}
