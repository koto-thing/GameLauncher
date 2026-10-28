use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::*;

/// 契約エラーを作る
/// 引数: code、status、requestId
/// 戻り値: HTTP応答
fn error(code: &str, status: u16, id: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({"error":{"code":code,"requestId":id}}))?.with_status(status))
}

/// 運営申請一覧を受付順にページングする
/// 引数: request、DB、開催ID、requestId
/// 戻り値: 期限内の型付き運営DTOページ
pub async fn list(
    req: &Request,
    db: &D1Database,
    event: &str,
    request_id: &str,
) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    let url = req.url()?;
    let params = url
        .query_pairs()
        .collect::<std::collections::BTreeMap<_, _>>();
    if params
        .keys()
        .any(|k| !["review", "withdrawal", "cursor", "limit"].contains(&k.as_ref()))
    {
        return error("VALIDATION", 422, request_id);
    }
    let review = params.get("review").map(|s| s.as_ref()).unwrap_or("");
    let withdrawal = params.get("withdrawal").map(|s| s.as_ref()).unwrap_or("");
    if ![
        "",
        "pending",
        "held",
        "approved",
        "returned",
        "resubmitted",
        "rejected",
        "withdrawn",
    ]
    .contains(&review)
        || !["", "none", "requested", "confirmed"].contains(&withdrawal)
    {
        return error("VALIDATION", 422, request_id);
    }
    let limit = match params.get("limit").map(|s| s.parse::<u32>()).transpose() {
        Ok(v) => v.unwrap_or(50),
        Err(_) => return error("VALIDATION", 422, request_id),
    };
    if !(1..=100).contains(&limit) {
        return error("VALIDATION", 422, request_id);
    }
    let parent = db
        .prepare("SELECT private_expires FROM lt_events WHERE id=?1")
        .bind(&[event.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let Some(parent) = parent.first() else {
        return error("NOT_FOUND", 404, request_id);
    };
    if parent["private_expires"].as_f64().is_some_and(|v| v <= now) {
        return error("RETENTION_EXPIRED", 410, request_id);
    }
    let cursor = params.get("cursor").map(|s| s.as_ref()).unwrap_or("");
    let mut submitted = String::new();
    if !cursor.is_empty() {
        let rows=db.prepare("SELECT json_extract(dto,'$.firstSubmittedAt') AS submitted FROM lt_applications WHERE id=?1 AND event_id=?2").bind(&[cursor.into(),event.into()])?.all().await?.results::<Value>()?;
        let Some(r) = rows.first() else {
            return error("VALIDATION", 422, request_id);
        };
        submitted = r["submitted"].as_str().unwrap().into();
    }
    let rows=db.prepare("SELECT id,dto,operator_note FROM lt_applications WHERE event_id=?1 AND (?2='' OR json_extract(dto,'$.review')=?2) AND (?3='' OR json_extract(dto,'$.withdrawal')=?3) AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch')) AND (?4='' OR json_extract(dto,'$.firstSubmittedAt')>?5 OR (json_extract(dto,'$.firstSubmittedAt')=?5 AND id>?4)) ORDER BY json_extract(dto,'$.firstSubmittedAt'),id LIMIT ?6").bind(&[event.into(),review.into(),withdrawal.into(),cursor.into(),submitted.into(),((limit+1) as f64).into()])?.all().await?.results::<Value>()?;
    let more = rows.len() > limit as usize;
    let mut items = Vec::new();
    let mut last = String::new();
    for row in rows.iter().take(limit as usize) {
        let mut dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
        dto["operatorNote"] = row["operator_note"].clone();
        items.push(dto);
        last = row["id"].as_str().unwrap().into();
    }
    let items = crate::views::list(db, items, true).await?;
    Response::from_json(&json!({"items":items,"nextCursor":if more{Some(last)}else{None}}))
}

/// 全体中止を親versionで原子的に確定する
/// 引数: request、DB、開催ID、actor、requestId
/// 戻り値: 中止済み設定または競合
pub async fn cancel(
    req: &mut Request,
    db: &D1Database,
    event: &str,
    actor: &str,
    request_id: &str,
) -> Result<Response> {
    // 期限後の中止再送もreceipt参照前に拒否する
    let now = crate::lifecycle::now(db).await?;
    let parent = db
        .prepare("SELECT private_expires FROM lt_events WHERE id=?1")
        .bind(&[event.into()])?
        .all()
        .await?
        .results::<Value>()?;
    if parent
        .first()
        .is_some_and(|r| r["private_expires"].as_f64().is_some_and(|v| v <= now))
    {
        return error("RETENTION_EXPIRED", 410, request_id);
    }
    let value: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422, request_id),
    };
    if !value.as_object().is_some_and(|o| {
        o.len() == 3
            && o.contains_key("expectedVersion")
            && o.contains_key("operationId")
            && o.contains_key("data")
    }) || value["data"] != json!({})
        || !value["expectedVersion"].as_u64().is_some_and(|n| n > 0)
        || !value["operationId"].as_str().is_some_and(|s| !s.is_empty())
    {
        return error("VALIDATION", 422, request_id);
    }
    let op = value["operationId"].as_str().unwrap();
    let hash = Sha256::digest(format!("{event}:{value}").as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let prior=db.prepare("SELECT result,payload_hash FROM lt_event_cancellations WHERE actor=?1 AND operation_id=?2 AND (expires IS NULL OR expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))").bind(&[actor.into(),op.into()])?.all().await?.results::<Value>()?;
    if let Some(row) = prior.first() {
        return if row["payload_hash"] == hash {
            Response::from_json(
                &crate::views::event(
                    db,
                    &serde_json::from_str::<Value>(row["result"].as_str().unwrap())?,
                )
                .await?,
            )
        } else {
            error("VERSION_CONFLICT", 409, request_id)
        };
    }
    let result=db.prepare("UPDATE lt_events SET state='cancelled',publish_enabled=0,version=version+1,cancel_actor=?1,cancel_operation=?2,cancel_hash=?3 WHERE id=?4 AND version=?5 AND state IN ('scheduled','started') AND (private_expires IS NULL OR private_expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))").bind(&[actor.into(),op.into(),hash.clone().into(),event.into(),(value["expectedVersion"].as_u64().unwrap() as f64).into()])?.run().await?;
    if result.meta()?.unwrap().changes.unwrap_or(0) == 0 {
        if let Some(response) =
            crate::receipts::response(db, "cancel", actor, op, &hash, request_id).await?
        {
            return Ok(response);
        }
        return error("VERSION_CONFLICT", 409, request_id);
    }
    Response::from_json(
        &crate::events::detail(db, event)
            .await?
            .ok_or_else(|| Error::RustError("Missing cancelled event".into()))?,
    )
}

/// 辞退確定と開催前の時間割再生成を同じトランザクションで行う
///
/// # 引数
/// - `db`: 申請と時間割を保存するデータベース
/// - `planned`: 更新予定の申請DTO
/// - `id`: 辞退する申請のID
/// - `version`: 更新前の申請版
/// - `op`: 重複実行を防ぐ操作ID
/// - `hash`: 操作内容を照合するハッシュ
/// - `actor`: 操作を行う運営者のID
/// - `note`: 保存する運営メモ
/// - `request_id`: エラー応答の追跡用ID
///
/// # 戻り値
/// 更新済み申請または競合を示すHTTP応答
///
/// # エラー
/// データベース処理または保存済み日時の解析に失敗した場合
pub async fn withdraw(
    db: &D1Database,
    planned: &Value,
    id: &str,
    version: u64,
    op: &str,
    hash: &str,
    actor: &str,
    note: &str,
    request_id: &str,
) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    if let Some(response) =
        crate::receipts::response(db, "operator", actor, op, hash, request_id).await?
    {
        return Ok(response);
    }
    let attempt = crate::applicant::secret()?;
    let event = planned["eventId"].as_str().unwrap();
    let rows=db.prepare("SELECT e.version AS event_version,e.state,s.version AS schedule_version,s.blocks,p.dto FROM lt_events e JOIN lt_schedule s ON s.event_id=e.id JOIN lt_public_events p ON p.event_id=e.id WHERE e.id=?1 AND e.state!='cancelled' AND (e.private_expires IS NULL OR e.private_expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))").bind(&[event.into()])?.all().await?.results::<Value>()?;
    let Some(row) = rows.first() else {
        return error("VERSION_CONFLICT", 409, request_id);
    };
    let public: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    let mut blocks: Vec<Value> = serde_json::from_str(row["blocks"].as_str().unwrap())?;
    let before = row["state"] == "scheduled"
        && chrono::DateTime::parse_from_rfc3339(public["startsAt"].as_str().unwrap())
            .map(|d| d.timestamp_millis() as f64 > now)
            .unwrap_or(false);
    // 開催前は発表と直後入替を取り除き、その後の休憩・閉会も同じ差分で移動する
    if before {
        let Some(index) = blocks
            .iter()
            .position(|b| b["kind"] == "talk" && b["talkId"] == id)
        else {
            if let Some(response) =
                crate::receipts::response(db, "operator", actor, op, hash, request_id).await?
            {
                return Ok(response);
            }
            return error("INVALID_TRANSITION", 409, request_id);
        };
        if blocks
            .get(index + 1)
            .is_none_or(|b| b["kind"] != "transition")
        {
            return error("INVALID_TRANSITION", 409, request_id);
        }
        let start =
            chrono::DateTime::parse_from_rfc3339(blocks[index]["startsAt"].as_str().unwrap())
                .map_err(|_| Error::RustError("Invalid timetable".into()))?
                .timestamp_millis();
        let end =
            chrono::DateTime::parse_from_rfc3339(blocks[index + 1]["endsAt"].as_str().unwrap())
                .map_err(|_| Error::RustError("Invalid timetable".into()))?
                .timestamp_millis();
        blocks.drain(index..index + 2);
        for block in blocks.iter_mut().skip(index) {
            for key in ["startsAt", "endsAt"] {
                let time = chrono::DateTime::parse_from_rfc3339(block[key].as_str().unwrap())
                    .map_err(|_| Error::RustError("Invalid timetable".into()))?
                    .timestamp_millis()
                    - (end - start);
                block[key] = json!(
                    js_sys::Date::new(&(time as f64).into())
                        .to_iso_string()
                        .as_string()
                        .unwrap()
                );
            }
        }
    }
    let mut dto = planned.clone();
    dto["review"] = json!("withdrawn");
    dto["withdrawal"] = json!("confirmed");
    dto["slotReserved"] = json!(false);
    dto["published"]["cancelled"] = json!(true);
    dto["published"]["version"] = dto["version"].clone();
    // 勝者申請のop/version/hashにだけ時間割変更を従属させる
    let changed=db.batch(vec![db.prepare("UPDATE lt_applications SET dto=json_set(?1,'$.published.startsAt',json_extract(dto,'$.published.startsAt'),'$.published.endsAt',json_extract(dto,'$.published.endsAt')),version=version+1,active=0,operation_id=?2,payload_hash=?3,actor_id=?4,operator_note=?5,transition_id=?10 WHERE id=?6 AND version=?7 AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch')) AND json_extract(dto,'$.withdrawal')='requested' AND EXISTS(SELECT 1 FROM lt_events e JOIN lt_schedule s ON s.event_id=e.id WHERE e.id=lt_applications.event_id AND e.version=?8 AND s.version=?9 AND e.state!='cancelled')").bind(&[dto.to_string().into(),op.into(),hash.into(),actor.into(),note.into(),id.into(),(version as f64).into(),row["event_version"].as_f64().unwrap().into(),row["schedule_version"].as_f64().unwrap().into(),attempt.clone().into()])?,db.prepare("UPDATE lt_schedule SET blocks=?1,version=version+1,operation_id=?2,actor_id=?3,payload_hash=?4 WHERE event_id=?5 AND version=?6 AND EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=?7 AND a.version=?8 AND a.operation_id=?9 AND a.payload_hash=?4 AND a.actor_id=?3 AND json_extract(a.dto,'$.withdrawal')='confirmed' AND a.transition_id=?10)").bind(&[serde_json::to_string(&blocks)?.into(),format!("{op}:timetable").into(),actor.into(),hash.into(),event.into(),row["schedule_version"].as_f64().unwrap().into(),id.into(),((version+1) as f64).into(),op.into(),attempt.clone().into()])?,db.prepare("UPDATE lt_schedule SET blocks=(SELECT g.blocks FROM lt_generated_schedule g WHERE g.event_id=?1),version=version+1,operation_id=?2 WHERE event_id=?1 AND EXISTS(SELECT 1 FROM lt_events e JOIN lt_recruitment r ON r.event_id=e.id JOIN lt_applications a ON a.event_id=e.id WHERE e.id=?1 AND e.state='scheduled' AND r.schedule_mode='automatic' AND a.id=?3 AND a.transition_id=?4 AND a.operation_id=?5 AND a.actor_id=?6)").bind(&[event.into(),format!("{op}:generated").into(),id.into(),attempt.into(),op.into(),actor.into()])?]).await?;
    if changed[0].meta()?.unwrap().changes.unwrap_or(0) == 0 {
        if let Some(response) =
            crate::receipts::response(db, "operator", actor, op, hash, request_id).await?
        {
            return Ok(response);
        }
        return error("VERSION_CONFLICT", 409, request_id);
    }
    let saved = db
        .prepare("SELECT dto FROM lt_applications WHERE id=?1")
        .bind(&[id.into()])?
        .all()
        .await?
        .results::<Value>()?;
    dto = serde_json::from_str(saved[0]["dto"].as_str().unwrap())?;
    dto["operatorNote"] = json!(note);
    Response::from_json(&crate::views::app(db, &dto, true).await?)
}
