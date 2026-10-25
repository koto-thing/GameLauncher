use serde_json::{Value, json};
use worker::*;

/// 競合後にも勝者receiptを読み、同一操作の結果を揃える
/// 引数: DB、server固定の操作領域、actor、operationId、payload hash、requestId
/// 戻り値: 有効receiptの応答またはNone。更新の再実行はしない
pub async fn response(
    db: &D1Database,
    kind: &str,
    actor: &str,
    op: &str,
    hash: &str,
    request_id: &str,
) -> Result<Option<Response>> {
    let sql = match kind {
        "applicant" => {
            "SELECT r.result,r.payload_hash FROM lt_applicant_operations r JOIN lt_applications a ON a.id=r.application_id WHERE r.actor=?1 AND r.operation_id=?2 AND (r.expires IS NULL OR r.expires>unixepoch('subsec')*1000) AND (json_extract(a.dto,'$.retentionExpiresAt') IS NULL OR json_extract(a.dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
        }
        "operator" => {
            "SELECT r.result,r.payload_hash FROM lt_operator_operations r JOIN lt_applications a ON a.id=r.application_id WHERE r.actor=?1 AND r.operation_id=?2 AND (r.expires IS NULL OR r.expires>unixepoch('subsec')*1000) AND (json_extract(a.dto,'$.retentionExpiresAt') IS NULL OR json_extract(a.dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
        }
        "event" => {
            "SELECT r.result,r.payload_hash FROM lt_event_operations r JOIN lt_events e ON e.id=r.event_id WHERE r.actor=?1 AND r.operation_id=?2 AND (r.expires IS NULL OR r.expires>unixepoch('subsec')*1000) AND (e.private_expires IS NULL OR e.private_expires>unixepoch('subsec')*1000)"
        }
        "schedule" => {
            "SELECT r.result,r.payload_hash FROM lt_schedule_operations r JOIN lt_events e ON e.id=r.event_id WHERE r.actor=?1 AND r.operation_id=?2 AND (r.expires IS NULL OR r.expires>unixepoch('subsec')*1000) AND (e.private_expires IS NULL OR e.private_expires>unixepoch('subsec')*1000)"
        }
        "cancel" => {
            "SELECT r.result,r.payload_hash FROM lt_event_cancellations r JOIN lt_events e ON e.id=r.event_id WHERE r.actor=?1 AND r.operation_id=?2 AND (r.expires IS NULL OR r.expires>unixepoch('subsec')*1000) AND (e.private_expires IS NULL OR e.private_expires>unixepoch('subsec')*1000)"
        }
        _ => return Err(Error::RustError("Unknown receipt scope".into())),
    };
    let rows = db
        .prepare(sql)
        .bind(&[actor.into(), op.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    if row["payload_hash"] != hash {
        return Ok(Some(
            Response::from_json(
                &json!({"error":{"code":"VERSION_CONFLICT","requestId":request_id}}),
            )?
            .with_status(409),
        ));
    }
    let value: Value = serde_json::from_str(row["result"].as_str().unwrap())?;
    let value = match kind {
        "applicant" => crate::applicant_dto::sanitize(&value),
        "operator" => crate::applicant_dto::operator(&value),
        _ => Some(value),
    }
    .ok_or_else(|| Error::RustError("Invalid receipt DTO".into()))?;
    Ok(Some(Response::from_json(&value)?))
}
