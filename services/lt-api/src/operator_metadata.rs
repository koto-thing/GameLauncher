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
    session: Value,
    speaker_links: Vec<Value>,
}

/// 承認済み発表の追加情報だけを申請原稿と公開版へ原子的に保存する
///
/// # 引数
///
/// * `req` - 更新内容を持つ内部リクエスト
/// * `db` - 申請と公開版を保存するデータベース
/// * `id` - 更新対象の申請 ID
/// * `actor` - 認証済み運営者の識別子
/// * `request_id` - 応答に含める要求 ID
///
/// # 戻り値
///
/// 更新済み運営 DTO または契約エラーの応答、DB 操作などの失敗は Err
pub async fn save(
    req: &mut Request,
    db: &D1Database,
    id: &str,
    actor: &str,
    request_id: &str,
) -> Result<Response> {
    let error = |code: &str, status| {
        Response::from_json(&json!({"error":{"code":code,"requestId":request_id}}))
            .map(|r| r.with_status(status))
    };

    // 入力形式と楽観的排他・再送識別に必要な値を検証する
    let raw: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422),
    };
    let input: Input = match serde_json::from_value(raw.clone()) {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422),
    };
    if input.expected_version == 0 || input.operation_id.is_empty() {
        return error("VALIDATION", 422);
    }

    // 確定済みの同一操作なら保存済みの結果を返す
    let hash = Sha256::digest(format!("{id}:metadata:{raw}").as_bytes())
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

    // 申請の存在、保持期限、版、承認状態を確認する
    let rows = db
        .prepare("SELECT dto,operator_note FROM lt_applications WHERE id=?1")
        .bind(&[id.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let Some(row) = rows.first() else {
        return error("NOT_FOUND", 404);
    };
    let mut dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    if crate::applicant::expired(&dto, crate::lifecycle::now(db).await?) {
        return error("RETENTION_EXPIRED", 410);
    }
    if dto["version"] != input.expected_version {
        return error("VERSION_CONFLICT", 409);
    }
    if dto["review"] != "approved" || dto["withdrawal"] != "none" || !dto["published"].is_object() {
        return error("INVALID_TRANSITION", 409);
    }

    // 原稿と公開版へ同じ追加情報を反映し、それぞれ検証する
    for key in ["content", "published"] {
        let Some(speakers) = dto[key]["speakers"].as_array_mut() else {
            return error("VALIDATION", 422);
        };
        if speakers.len() != input.data.speaker_links.len() {
            return error("VALIDATION", 422);
        }
        for (speaker, links) in speakers.iter_mut().zip(&input.data.speaker_links) {
            speaker["links"] = links.clone();
        }
        dto[key]["session"] = input.data.session.clone();
        if !crate::session_info::valid(&dto[key]) {
            return error("VALIDATION", 422);
        }
    }

    // 更新後の版をそろえ、公開 DTO としての整合性を確認する
    dto["version"] = json!(input.expected_version + 1);
    dto["published"]["version"] = dto["version"].clone();
    if crate::public_dto::validate(&dto["published"], true).is_none() {
        return error("VALIDATION", 422);
    }

    // 時間割編集と競合しても最新の発表時刻を維持する
    let update = db.prepare("UPDATE lt_applications SET version=version+1,dto=json_set(?1,'$.published.startsAt',json_extract(dto,'$.published.startsAt'),'$.published.endsAt',json_extract(dto,'$.published.endsAt')),operation_id=?2,payload_hash=?3,actor_id=?4 WHERE id=?5 AND version=?6 AND json_extract(dto,'$.review')='approved' AND json_extract(dto,'$.withdrawal')='none' AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)/1000.0,'unixepoch')) AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_applications.event_id AND e.publish_enabled=1 AND e.state IN ('scheduled','started','ended'))").bind(&[dto.to_string().into(),input.operation_id.clone().into(),hash.clone().into(),actor.into(),id.into(),(input.expected_version as f64).into()])?;

    // 同一トランザクション内で確定した申請から公開版を更新する
    let publish = db.prepare("UPDATE lt_public_talks SET dto=(SELECT json_extract(a.dto,'$.published') FROM lt_applications a WHERE a.id=?1) WHERE id=?1 AND EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=?1 AND a.actor_id=?2 AND a.operation_id=?3 AND a.payload_hash=?4 AND a.version=?5)").bind(&[id.into(),actor.into(),input.operation_id.clone().into(),hash.clone().into(),((input.expected_version+1) as f64).into()])?;
    db.batch(vec![update, publish]).await?;

    // 条件付き更新が成立したか、操作の受領記録から確認する
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
    error("VERSION_CONFLICT", 409)
}
