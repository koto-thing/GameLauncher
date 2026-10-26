use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::wasm_bindgen::prelude::*;
use worker::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OperatorContext {
    actor_id: String,
    role: Role,
    request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Role {
    Admin,
    Executive,
    Assistant,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Approve {
    expected_version: u64,
    operation_id: String,
    data: ApproveData,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ApproveData {
    starts_at: String,
    expected_event_version: u64,
    expected_schedule_version: u64,
}

/// named service binding からだけ呼ぶ内部入口
/// 引数: proxy が検証した context、HTTP request、ホストが渡す binding 環境
/// 戻り値: Rust で生成した HTTP 応答
#[wasm_bindgen]
pub async fn operator_request(
    context: JsValue,
    request: web_sys::Request,
    env: Env,
) -> std::result::Result<web_sys::Response, JsValue> {
    let context: OperatorContext = serde_wasm_bindgen::from_value(context)
        .map_err(|_| JsValue::from_str("Invalid operator context"))?;
    let mut req = Request::from(request);
    let result = handle(&mut req, &env, &context).await;
    let response = match result {
        Ok(r) => r,
        Err(e)
            if e.to_string().contains("LT_OPERATION_CONFLICT")
                || e.to_string()
                    .contains("UNIQUE constraint failed: lt_schedule_operations")
                || e.to_string()
                    .contains("UNIQUE constraint failed: lt_email_change_operations") =>
        {
            error("VERSION_CONFLICT", 409, &context)
                .map_err(|e| JsValue::from_str(&e.to_string()))?
        }
        Err(e)
            if e.to_string().contains(
                "UNIQUE constraint failed: lt_applications.event_id, lt_applications.email",
            ) =>
        {
            error("DUPLICATE_APPLICATION", 409, &context)
                .map_err(|e| JsValue::from_str(&e.to_string()))?
        }
        Err(e) if e.to_string().contains("LT_CAPACITY_FULL") => {
            error("CAPACITY_FULL", 409, &context).map_err(|e| JsValue::from_str(&e.to_string()))?
        }
        Err(e) if e.to_string().contains("LT_RETENTION_EXPIRED") => {
            error("RETENTION_EXPIRED", 410, &context)
                .map_err(|e| JsValue::from_str(&e.to_string()))?
        }
        Err(e) => return Err(JsValue::from_str(&e.to_string())),
    };
    Ok(response.into())
}

/// 契約エラーを生成する
/// 引数: コード、status、検証済み context
/// 戻り値: 非公開応答
fn error(code: &str, status: u16, c: &OperatorContext) -> Result<Response> {
    Ok(
        Response::from_json(&json!({"error":{"code":code,"requestId":c.request_id}}))?
            .with_status(status),
    )
}

/// 内部運営の承認を原子的に適用する
/// 引数: request、環境、検証済み context
/// 戻り値: 運営 DTO または未対応応答
async fn handle(req: &mut Request, env: &Env, c: &OperatorContext) -> Result<Response> {
    // RPC context だけで本番を有効化せず、開発ビルドにも限定する
    if !crate::gate::operator_enabled(env) {
        return error("NOT_IMPLEMENTED", 501, c);
    }
    if c.actor_id.is_empty() || c.request_id.is_empty() {
        return error("FORBIDDEN", 403, c);
    }
    // 全3役割に通常運営権限。メール例外は本人確認手順未確定のため未対応
    let _operate = matches!(c.role, Role::Admin | Role::Executive | Role::Assistant);
    let path = req.path();
    let p: Vec<_> = path.trim_matches('/').split('/').collect();
    let db = env.d1("DB")?;
    let now = crate::lifecycle::reconcile(&db).await?;
    if !p.starts_with(&["api", "lt", "v1", "operator"]) {
        return error("NOT_FOUND", 404, c);
    }
    if let Some(response) = crate::events::handle(req, &db, &c.actor_id, &c.request_id).await? {
        return Ok(response);
    }
    if (p.len() == 7 || p.len() == 8) && p[4] == "applications" && p[6] == "email-change" {
        if matches!(c.role, Role::Assistant) {
            return error("FORBIDDEN", 403, c);
        }
        return crate::email_change::operate(
            env,
            req,
            &db,
            p[5],
            p.get(7).copied().unwrap_or(""),
            &c.actor_id,
            &c.request_id,
            &env.var("APP_ORIGIN")?.to_string(),
        )
        .await;
    }
    if req.method() == Method::Put && p.len() == 7 && p[4] == "events" && p[6] == "timetable" {
        return crate::timetable::save(req, &db, p[5], &c.actor_id, &c.request_id).await;
    }
    if req.method() == Method::Get && p.len() == 7 && p[4] == "events" && p[6] == "applications" {
        return crate::operations::list(req, &db, p[5], &c.request_id).await;
    }
    if req.method() == Method::Post && p.len() == 7 && p[4] == "events" && p[6] == "cancel" {
        return crate::operations::cancel(req, &db, p[5], &c.actor_id, &c.request_id).await;
    }
    if req.method() == Method::Post && p.len() == 7 && p[4] == "applications" && p[6] == "metadata"
    {
        return crate::operator_metadata::save(req, &db, p[5], &c.actor_id, &c.request_id).await;
    }
    if req.method() == Method::Get && p.len() == 6 && p[4] == "applications" {
        let rows = db
            .prepare("SELECT dto,operator_note FROM lt_applications WHERE id=?1")
            .bind(&[p[5].into()])?
            .all()
            .await?
            .results::<Value>()?;
        return if let Some(row) = rows.first() {
            let mut dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
            if crate::applicant::expired(&dto, now) {
                return error("RETENTION_EXPIRED", 410, c);
            }
            dto["operatorNote"] = row["operator_note"].clone();
            Response::from_json(&crate::views::app(&db, &dto, true).await?)
        } else {
            error("NOT_FOUND", 404, c)
        };
    }
    if req.method() == Method::Get && p.len() == 7 && p[4] == "events" && p[6] == "timetable" {
        let rows=db.prepare("SELECT s.version,s.blocks,e.version AS event_version FROM lt_schedule s JOIN lt_events e ON e.id=s.event_id WHERE s.event_id=?1 AND (e.private_expires IS NULL OR e.private_expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))").bind(&[p[5].into()])?.all().await?.results::<Value>()?;
        return if let Some(r) = rows.first() {
            Response::from_json(
                &json!({"eventId":p[5],"version":r["version"],"eventVersion":r["event_version"],"blocks":serde_json::from_str::<Value>(r["blocks"].as_str().unwrap())?}),
            )
        } else {
            error("NOT_FOUND", 404, c)
        };
    }
    if req.method() == Method::Post
        && p.len() == 7
        && p[4] == "applications"
        && [
            "return",
            "reapprove",
            "hold",
            "reject",
            "confirm-withdrawal",
        ]
        .contains(&p[6])
    {
        return review(req, &db, c, p[5], p[6]).await;
    }
    if req.method() != Method::Post || p.len() != 7 || p[4] != "applications" || p[6] != "approve" {
        return error("NOT_IMPLEMENTED", 501, c);
    }
    let input: Approve = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422, c),
    };
    if input.expected_version == 0
        || input.operation_id.is_empty()
        || input.data.expected_event_version == 0
        || input.data.expected_schedule_version == 0
    {
        return error("VALIDATION", 422, c);
    }
    let start = js_sys::Date::new(&input.data.starts_at.clone().into()).get_time();
    if !start.is_finite()
        || js_sys::Date::new(&start.into())
            .to_iso_string()
            .as_string()
            .as_deref()
            != Some(&input.data.starts_at)
    {
        return error("VALIDATION", 422, c);
    }
    let payload = Sha256::digest(
        format!(
            "{}:{}:{}:{}:{}:{}",
            c.actor_id,
            p[5],
            input.expected_version,
            input.data.expected_event_version,
            input.data.expected_schedule_version,
            input.data.starts_at
        )
        .as_bytes(),
    )
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect::<String>();
    let replay=db.prepare("SELECT payload_hash,result AS dto FROM lt_operator_operations WHERE EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=lt_operator_operations.application_id AND (json_extract(a.dto,'$.retentionExpiresAt') IS NULL OR json_extract(a.dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch'))) AND operation_id=?1 AND actor=?2 AND (expires IS NULL OR expires>CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER))").bind(&[input.operation_id.clone().into(),c.actor_id.clone().into()])?.all().await?.results::<Value>()?;
    if let Some(r) = replay.first() {
        if r["payload_hash"] != payload {
            return error("VERSION_CONFLICT", 409, c);
        }
        let mut dto: Value = serde_json::from_str(r["dto"].as_str().unwrap())?;
        if dto.get("operatorNote").is_none() {
            dto["operatorNote"] = json!("");
        }
        return Response::from_json(&crate::views::app(&db, &dto, true).await?);
    }
    let rows=db.prepare("SELECT a.dto,a.operator_note,r.talk_minutes FROM lt_applications a JOIN lt_recruitment r ON r.event_id=a.event_id WHERE a.id=?1").bind(&[p[5].into()])?.all().await?.results::<Value>()?;
    let Some(row) = rows.first() else {
        return error("NOT_FOUND", 404, c);
    };
    let mut dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    if crate::applicant::expired(&dto, now) {
        return error("RETENTION_EXPIRED", 410, c);
    }
    let end = js_sys::Date::new(&(start + row["talk_minutes"].as_f64().unwrap() * 60000.0).into())
        .to_iso_string()
        .as_string()
        .unwrap();
    let mut published = dto["content"].clone();
    for (k, v) in [
        ("id", dto["id"].clone()),
        ("eventId", dto["eventId"].clone()),
        ("version", json!(input.expected_version + 1)),
        ("startsAt", json!(input.data.starts_at)),
        ("endsAt", json!(end)),
        ("cancelled", json!(false)),
    ] {
        published[k] = v;
    }
    if crate::public_dto::validate(&published, true).is_none() {
        return error("VALIDATION", 422, c);
    }
    dto["version"] = json!(input.expected_version + 1);
    dto["review"] = json!("approved");
    dto["everApproved"] = json!(true);
    dto["slotReserved"] = json!(true);
    dto["published"] = published;
    // UPDATE 0件では trigger は動かず、枠・公開版・outbox・audit は作られない
    let changed=db.prepare("UPDATE lt_applications SET version=version+1,dto=?1,operation_id=?2,payload_hash=?3,actor_id=?4 WHERE id=?5 AND version=?6 AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch')) AND json_extract(dto,'$.everApproved')=0 AND json_extract(dto,'$.review') IN ('pending','held') AND json_extract(dto,'$.withdrawal')='none' AND EXISTS(SELECT 1 FROM lt_events e JOIN lt_schedule s ON s.event_id=e.id JOIN lt_public_events pe ON pe.event_id=e.id WHERE e.id=lt_applications.event_id AND json_extract(pe.dto,'$.startsAt')<=?10 AND COALESCE(json_extract(s.blocks,'$[#-1].endsAt'),json_extract(pe.dto,'$.startsAt'))=?10 AND COALESCE(json_extract(s.blocks,'$[#-1].kind'),'opening')!='closing' AND e.version=?7 AND s.version=?8 AND e.publish_enabled=1 AND e.state IN ('scheduled','started') AND NOT EXISTS(SELECT 1 FROM json_each(s.blocks) b WHERE json_extract(b.value,'$.startsAt')<?9 AND json_extract(b.value,'$.endsAt')>?10))").bind(&[dto.to_string().into(),input.operation_id.clone().into(),payload.clone().into(),c.actor_id.clone().into(),p[5].into(),(input.expected_version as f64).into(),(input.data.expected_event_version as f64).into(),(input.data.expected_schedule_version as f64).into(),end.into(),input.data.starts_at.into()])?.run().await?;
    if changed.meta()?.unwrap().changes.unwrap_or(0) == 0 {
        if let Some(response) = crate::receipts::response(
            &db,
            "operator",
            &c.actor_id,
            &input.operation_id,
            &payload,
            &c.request_id,
        )
        .await?
        {
            return Ok(response);
        }
        return error("VERSION_CONFLICT", 409, c);
    }
    dto["operatorNote"] = row["operator_note"].clone();
    Response::from_json(&crate::views::app(&db, &dto, true).await?)
}

/// 差し戻しと再承認などを版条件で適用する
/// 引数: request、DB、context、申請ID、操作
/// 戻り値: 更新済み運営 DTO
async fn review(
    req: &mut Request,
    db: &D1Database,
    c: &OperatorContext,
    id: &str,
    action: &str,
) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    let v: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422, c),
    };
    let data = &v["data"];
    let keys = if action == "reapprove" {
        vec!["expectedEventVersion"]
    } else {
        vec![]
    };
    if !v.as_object().is_some_and(|o| {
        o.len() == 3
            && o.contains_key("expectedVersion")
            && o.contains_key("operationId")
            && o.contains_key("data")
    }) || !v["expectedVersion"].as_u64().is_some_and(|x| x > 0)
        || !v["operationId"].as_str().is_some_and(|s| !s.is_empty())
        || !data.as_object().is_some_and(|o| {
            if action == "reapprove" {
                o.len() == 1
                    && o.contains_key(keys[0])
                    && data[keys[0]].as_u64().is_some_and(|x| x > 0)
            } else {
                o.keys().all(|k| k == "note") && o.get("note").is_none_or(|n| n.is_string())
            }
        })
    {
        return error("VALIDATION", 422, c);
    }
    let op = v["operationId"].as_str().unwrap();
    let payload = Sha256::digest(format!("{id}:{action}:{v}").as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let replay=db.prepare("SELECT result,payload_hash FROM lt_operator_operations WHERE EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=lt_operator_operations.application_id AND (json_extract(a.dto,'$.retentionExpiresAt') IS NULL OR json_extract(a.dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch'))) AND actor=?1 AND operation_id=?2 AND (expires IS NULL OR expires>CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER))").bind(&[c.actor_id.clone().into(),op.into()])?.all().await?.results::<Value>()?;
    if let Some(r) = replay.first() {
        if r["payload_hash"] != payload {
            return error("VERSION_CONFLICT", 409, c);
        }
        let mut dto: Value = serde_json::from_str(r["result"].as_str().unwrap())?;
        if dto.get("operatorNote").is_none() {
            dto["operatorNote"] = json!("");
        }
        return Response::from_json(&crate::views::app(&db, &dto, true).await?);
    }
    let rows = db
        .prepare("SELECT dto,operator_note FROM lt_applications WHERE id=?1")
        .bind(&[id.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let Some(row) = rows.first() else {
        return error("NOT_FOUND", 404, c);
    };
    let mut dto: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    if crate::applicant::expired(&dto, now) {
        return error("RETENTION_EXPIRED", 410, c);
    }
    if crate::applicant::expired(&dto, now) {
        return error("RETENTION_EXPIRED", 410, c);
    }
    if dto["version"] != v["expectedVersion"] {
        if let Some(response) =
            crate::receipts::response(db, "operator", &c.actor_id, op, &payload, &c.request_id)
                .await?
        {
            return Ok(response);
        }
        return error("VERSION_CONFLICT", 409, c);
    }
    if crate::applicant::expired(&dto, now) {
        return error("RETENTION_EXPIRED", 410, c);
    }
    #[cfg(feature = "runtime-tests")]
    let observed = crate::test_hooks::pause(req, &dto).await?;
    let state = dto["review"].as_str().unwrap_or("");
    let ever = dto["everApproved"] == true;
    let allowed = match action {
        "return" => state == "approved",
        "reapprove" => state == "resubmitted" && ever,
        "hold" => state == "pending",
        "reject" => !ever && ["pending", "held", "returned", "resubmitted"].contains(&state),
        "confirm-withdrawal" => dto["withdrawal"] == "requested",
        _ => false,
    };
    if !allowed {
        return error("INVALID_TRANSITION", 409, c);
    }
    dto["version"] = json!(v["expectedVersion"].as_u64().unwrap() + 1);
    match action {
        "return" => dto["review"] = json!("returned"),
        "hold" => dto["review"] = json!("held"),
        "reject" => dto["review"] = json!("rejected"),
        "reapprove" => {
            let mut published = dto["content"].clone();
            for key in ["id", "eventId", "startsAt", "endsAt", "cancelled"] {
                published[key] = dto["published"][key].clone();
            }
            published["version"] = dto["version"].clone();
            if crate::public_dto::validate(&published, true).is_none() {
                return error("VALIDATION", 422, c);
            }
            dto["published"] = published;
            dto["review"] = json!("approved");
        }
        // 辞退確定は枠解放と時間割変更を同じbatchにまとめる
        "confirm-withdrawal" => {
            return crate::operations::withdraw(
                &db,
                &dto,
                id,
                v["expectedVersion"].as_u64().unwrap(),
                op,
                &payload,
                &c.actor_id,
                data.get("note")
                    .and_then(Value::as_str)
                    .unwrap_or(row["operator_note"].as_str().unwrap_or("")),
                &c.request_id,
            )
            .await;
        }
        _ => {}
    }
    let expected_event = if action == "reapprove" {
        v["data"]["expectedEventVersion"].as_u64().unwrap() as f64
    } else {
        -1.0
    };
    let changed=db.prepare("UPDATE lt_applications SET version=version+1,dto=CASE WHEN json_type(?1,'$.published')='object' THEN json_set(?1,'$.published.startsAt',json_extract(dto,'$.published.startsAt'),'$.published.endsAt',json_extract(dto,'$.published.endsAt')) ELSE ?1 END,operation_id=?2,payload_hash=?3,actor_id=?4,operator_note=COALESCE(?8,operator_note),active=CASE WHEN json_extract(?1,'$.review') IN ('rejected','withdrawn') THEN 0 ELSE 1 END WHERE id=?5 AND version=?6 AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch')) AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_applications.event_id AND e.publish_enabled=1 AND e.state IN ('scheduled','started','ended') AND (?7<0 OR e.version=?7))").bind(&[dto.to_string().into(),op.into(),payload.clone().into(),c.actor_id.clone().into(),id.into(),(v["expectedVersion"].as_u64().unwrap() as f64).into(),expected_event.into(),data.get("note").and_then(Value::as_str).map(JsValue::from_str).unwrap_or(JsValue::NULL)])?.run().await?;
    if changed.meta()?.unwrap().changes.unwrap_or(0) == 0 {
        if let Some(response) =
            crate::receipts::response(&db, "operator", &c.actor_id, op, &payload, &c.request_id)
                .await?
        {
            return Ok(response);
        }
        return error("VERSION_CONFLICT", 409, c);
    }
    let saved = db
        .prepare("SELECT dto,operator_note FROM lt_applications WHERE id=?1")
        .bind(&[id.into()])?
        .all()
        .await?
        .results::<Value>()?;
    dto = serde_json::from_str(saved[0]["dto"].as_str().unwrap())?;
    dto["operatorNote"] = data
        .get("note")
        .cloned()
        .unwrap_or(row["operator_note"].clone());
    let response = Response::from_json(&crate::views::app(&db, &dto, true).await?)?;
    #[cfg(feature = "runtime-tests")]
    let response = crate::test_hooks::annotate(response, observed)?;
    Ok(response)
}

/// ローカル outbox を fake adapter に一度だけ渡す
/// 引数: 内部ホストが渡す環境
/// 戻り値: 配達済み件数（私有項目は返さない）
#[wasm_bindgen]
pub async fn fake_dispatch(env: Env) -> std::result::Result<JsValue, JsValue> {
    if !cfg!(feature = "local-development")
        || env
            .var("LOCAL_AUTH")
            .map(|v| v.to_string())
            .unwrap_or_default()
            != "true"
    {
        return Err(JsValue::from_str("Disabled"));
    }
    let db = env
        .d1("DB")
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    crate::lifecycle::reconcile(&db)
        .await
        .map_err(|_| JsValue::from_str("Lifecycle unavailable"))?;
    // 旧fake配送を廃止し、同じmode/claim/fence経路だけを使う
    let origin = env
        .var("APP_ORIGIN")
        .map_err(|_| JsValue::from_str("Mail unavailable"))?
        .to_string();
    let count = crate::mail::dispatch(&env, &db, &origin, lt_mail::Outcome::Accepted, 50)
        .await
        .map_err(|_| JsValue::from_str("Mail unavailable"))?;
    Ok(JsValue::from_f64(count as f64))
}
