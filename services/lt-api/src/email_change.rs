use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Mutation<T> {
    expected_version: u64,
    operation_id: String,
    data: T,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Identity {
    new_email: String,
    identity_checked: bool,
    identity_check_method: String,
    identity_check_result: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Action {
    request_id: String,
    expected_request_version: u64,
}

/// 秘密値または操作payloadをhash化する
/// 引数: 文字列
/// 戻り値: SHA256 hex
fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
/// 契約エラーを生成する
/// 引数: code/status、信頼済みrequest ID
/// 戻り値: 私有情報を含まない応答
fn error(code: &str, status: u16, rid: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({"error":{"code":code,"requestId":rid}}))?.with_status(status))
}
/// epochミリ秒を契約時刻にする
/// 引数: 時刻JSON
/// 戻り値: UTC時刻またはnull
fn instant(value: &Value) -> Value {
    value
        .as_f64()
        .map(|v| {
            json!(
                js_sys::Date::new(&v.into())
                    .to_iso_string()
                    .as_string()
                    .unwrap()
            )
        })
        .unwrap_or(Value::Null)
}
/// 現在の申請versionを含むrequest DTOを構成する
/// 引数: DB、対象申請、任意request ID（空はcurrent）
/// 戻り値: current requestまたはnull
async fn current(db: &D1Database, app: &str, id: &str) -> Result<Value> {
    let rows=db.prepare("SELECT r.*,a.version AS application_version,a.email FROM lt_email_changes r JOIN lt_applications a ON a.id=r.application_id WHERE r.application_id=?1 AND r.current=1 AND (r.expires IS NULL OR r.expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)) AND (?2='' OR r.id=?2) AND ((r.state='confirmed' AND a.email=r.new_email) OR (r.state!='confirmed' AND a.email=r.old_email))").bind(&[app.into(),id.into()])?.all().await?.results::<Value>()?;
    Ok(rows.first().map(|r|json!({"id":r["id"],"applicationId":app,"version":r["version"],"state":r["state"],"newEmail":r["new_email"],"applicationVersion":r["application_version"],"verificationExpiresAt":instant(&r["verification_expires"]),"verifiedAt":r["verified_at"]})).unwrap_or(Value::Null))
}
/// 各操作の前に同じ開催回と保持期限を確認する
/// 引数: DB、対象申請
/// 戻り値: authoritativeな親行
async fn load_parent(db: &D1Database, id: &str) -> Result<Option<Value>> {
    Ok(db.prepare("SELECT a.email,a.version,a.event_id,e.state,e.publish_enabled,e.private_expires FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1").bind(&[id.into()])?.all().await?.results::<Value>()?.into_iter().next())
}
/// 操作receiptは古いDTOを返さずcurrent requestから再構成する
/// 引数: DB、対象申請、actor/op/hash、request ID
/// 戻り値: 既存操作の応答またはNone
async fn replay(
    db: &D1Database,
    app: &str,
    actor: &str,
    op: &str,
    payload: &str,
    rid: &str,
) -> Result<Option<Response>> {
    let rows = db
        .prepare("SELECT * FROM lt_email_change_operations WHERE actor=?1 AND operation_id=?2")
        .bind(&[actor.into(), op.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    if row["application_id"] != app || row["payload_hash"] != payload {
        return Ok(Some(error("VERSION_CONFLICT", 409, rid)?));
    }
    let dto = current(db, app, row["request_id"].as_str().unwrap()).await?;
    Ok(Some(if dto.is_null() {
        error("VERSION_CONFLICT", 409, rid)?
    } else {
        Response::from_json(&dto)?
    }))
}

/// Admin/幹部だけから呼ばれるメール変更の状態遷移
/// 引数: HTTP、DB、申請ID、操作名、信頼済みactor/request ID、公開origin
/// 戻り値: current requestまたは契約エラー
pub async fn operate(
    env: &Env,
    req: &mut Request,
    db: &D1Database,
    app: &str,
    action: &str,
    actor: &str,
    rid: &str,
    origin: &str,
) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    let Some(parent) = load_parent(db, app).await? else {
        return error("NOT_FOUND", 404, rid);
    };
    if parent["private_expires"].as_f64().is_some_and(|v| v <= now) {
        return error("RETENTION_EXPIRED", 410, rid);
    }
    if req.method() == Method::Get && action.is_empty() {
        return Response::from_json(&current(db, app, "").await?);
    }
    if req.method() != Method::Post
        || !["investigate", "send-verification", "confirm"].contains(&action)
    {
        return error("NOT_FOUND", 404, rid);
    }
    if !["scheduled", "started", "ended"].contains(&parent["state"].as_str().unwrap_or(""))
        || parent["publish_enabled"] != 1
    {
        return error("INVALID_TRANSITION", 409, rid);
    }
    let raw: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422, rid),
    };
    // 本文の受信中にも時間は進むため、書込前に状態と保持期限を再確認する
    let now = crate::lifecycle::reconcile(db).await?;
    let Some(parent) = load_parent(db, app).await? else {
        return error("NOT_FOUND", 404, rid);
    };
    if parent["private_expires"].as_f64().is_some_and(|v| v <= now) {
        return error("RETENTION_EXPIRED", 410, rid);
    }
    if !["scheduled", "started", "ended"].contains(&parent["state"].as_str().unwrap_or(""))
        || parent["publish_enabled"] != 1
    {
        return error("INVALID_TRANSITION", 409, rid);
    }
    let (expected, op, new_email, request_id, request_version, method) = if action == "investigate"
    {
        let v: Mutation<Identity> = match serde_json::from_value(raw.clone()) {
            Ok(v) => v,
            Err(_) => return error("VALIDATION", 422, rid),
        };
        let email = v.data.new_email.to_lowercase();
        if !v.data.identity_checked
            || v.data.identity_check_result != "confirmed"
            || v.data.identity_check_method.trim().is_empty()
            || v.data.identity_check_method.chars().count() > 80
            || email.len() > 254
            || email.split('@').count() != 2
            || email.split('@').any(|p| p.is_empty())
            || email.chars().any(char::is_whitespace)
        {
            return error("VALIDATION", 422, rid);
        }
        (
            v.expected_version,
            v.operation_id,
            email,
            crate::applicant::secret()?,
            0,
            v.data.identity_check_method,
        )
    } else {
        let v: Mutation<Action> = match serde_json::from_value(raw.clone()) {
            Ok(v) => v,
            Err(_) => return error("VALIDATION", 422, rid),
        };
        if v.data.request_id.is_empty() || v.data.expected_request_version == 0 {
            return error("VALIDATION", 422, rid);
        }
        let rows=db.prepare("SELECT new_email FROM lt_email_changes WHERE id=?1 AND application_id=?2 AND current=1").bind(&[v.data.request_id.clone().into(),app.into()])?.all().await?.results::<Value>()?;
        let email = rows
            .first()
            .and_then(|r| r["new_email"].as_str())
            .unwrap_or("")
            .to_owned();
        (
            v.expected_version,
            v.operation_id,
            email,
            v.data.request_id,
            v.data.expected_request_version,
            String::new(),
        )
    };
    if expected == 0 || op.is_empty() {
        return error("VALIDATION", 422, rid);
    }
    let payload = hash(&format!("{}:{}:{raw}", req.method(), req.path()));
    if let Some(r) = replay(db, app, actor, &op, &payload, rid).await? {
        return Ok(r);
    }
    if new_email.is_empty() {
        return error("VERSION_CONFLICT", 409, rid);
    }
    if new_email == parent["email"] {
        return error(
            if action == "investigate" {
                "VALIDATION"
            } else {
                "INVALID_TRANSITION"
            },
            if action == "investigate" { 422 } else { 409 },
            rid,
        );
    }
    let collision = db
        .prepare(
            "SELECT id FROM lt_applications WHERE event_id=?1 AND email=?2 AND active=1 AND id!=?3",
        )
        .bind(&[
            parent["event_id"].as_str().unwrap().into(),
            new_email.clone().into(),
            app.into(),
        ])?
        .all()
        .await?
        .results::<Value>()?;
    if !collision.is_empty() {
        return error("DUPLICATE_APPLICATION", 409, rid);
    }
    let nonce = crate::applicant::secret()?;
    let request_guard = if action == "investigate" {
        String::new()
    } else {
        format!(
            " AND EXISTS(SELECT 1 FROM lt_email_changes r WHERE r.id=?6 AND r.application_id=lt_applications.id AND r.current=1 AND r.version=?7 AND r.old_email=lt_applications.email AND {})",
            if action == "confirm" {
                "r.state='verified' AND r.verified_at IS NOT NULL"
            } else {
                "r.state IN('investigating','verificationPending')"
            }
        )
    };
    let change_email = if action == "confirm" {
        "email=?4,dto=json_set(dto,'$.version',version+1,'$.representativeEmail',?4),"
    } else {
        "dto=json_set(dto,'$.version',version+1),"
    };
    let sql = format!(
        "UPDATE lt_applications SET {change_email}version=version+1,email_fence=?1 WHERE id=?2 AND version=?3 AND NOT EXISTS(SELECT 1 FROM lt_applications b WHERE b.event_id=lt_applications.event_id AND b.email=?4 AND b.active=1 AND b.id!=lt_applications.id) AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_applications.event_id AND e.publish_enabled=1 AND e.state IN('scheduled','started','ended') AND (e.private_expires IS NULL OR e.private_expires>MAX(?5,COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)))) {request_guard}"
    );
    let mut values = vec![
        nonce.clone().into(),
        app.into(),
        (expected as f64).into(),
        new_email.clone().into(),
        now.into(),
    ];
    if action != "investigate" {
        values.extend([request_id.clone().into(), (request_version as f64).into()]);
    }
    let mut statements = vec![db.prepare(sql).bind(&values)?];
    let won = "EXISTS(SELECT 1 FROM lt_applications WHERE id=?1 AND email_fence=?2)";
    if action == "investigate" {
        statements.push(db.prepare(format!("UPDATE lt_email_change_tokens SET expires=MIN(expires,?3) WHERE request_id IN(SELECT id FROM lt_email_changes WHERE application_id=?1 AND current=1) AND used=0 AND {won}")).bind(&[app.into(),nonce.clone().into(),now.into()])?);
        statements.push(db.prepare(format!("UPDATE lt_email_changes SET current=0,state='cancelled',version=version+1 WHERE application_id=?1 AND current=1 AND {won}")).bind(&[app.into(),nonce.clone().into()])?);
        statements.push(db.prepare(format!("INSERT INTO lt_email_changes(id,application_id,event_id,current,state,old_email,new_email,actor,identity_method,identity_result,checked_at,expires) SELECT ?3,a.id,a.event_id,1,'investigating',a.email,?4,?5,?6,'confirmed',?7,e.private_expires FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1 AND a.email_fence=?2")).bind(&[app.into(),nonce.clone().into(),request_id.clone().into(),new_email.clone().into(),actor.into(),method.into(),instant(&json!(now)).as_str().unwrap().into()])?);
    } else if action == "send-verification" {
        let token = crate::applicant::secret()?;
        let token_hash = hash(&token);
        let expires = (now + 3600000.0).min(parent["private_expires"].as_f64().unwrap_or(f64::MAX));
        let outbox = format!("email-link:{nonce}");
        statements.push(db.prepare(format!("UPDATE lt_email_change_tokens SET expires=MIN(expires,?4) WHERE request_id=?3 AND used=0 AND {won}")).bind(&[app.into(),nonce.clone().into(),request_id.clone().into(),now.into()])?);
        statements.push(db.prepare(format!("INSERT INTO lt_email_change_tokens(hash,request_id,purpose,expires) SELECT ?3,?4,'email_change',?5 WHERE {won}")).bind(&[app.into(),nonce.clone().into(),token_hash.clone().into(),request_id.clone().into(),expires.into()])?);
        statements.push(db.prepare(format!("UPDATE lt_email_changes SET state='verificationPending',version=version+1,token_hash=?4,verification_expires=?5,verified_at=NULL WHERE id=?3 AND {won}")).bind(&[app.into(),nonce.clone().into(),request_id.clone().into(),token_hash.clone().into(),expires.into()])?);
        statements.push(db.prepare(format!("INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT ?3,?3,?1,'emailConfirmation',?4,?5 WHERE {won}")).bind(&[app.into(),nonce.clone().into(),outbox.clone().into(),new_email.clone().into(),expires.into()])?);
        statements.push(db.prepare(format!("INSERT INTO lt_email_change_payloads(outbox_id,token_hash,action_url) SELECT ?3,?4,?5 WHERE {won}")).bind(&[app.into(),nonce.clone().into(),outbox.into(),token_hash.into(),format!("{origin}/auth/email-change?token={token}").into()])?);
    } else {
        statements.push(db.prepare(format!("UPDATE lt_email_changes SET state='confirmed',version=version+1 WHERE id=?3 AND {won}")).bind(&[app.into(),nonce.clone().into(),request_id.clone().into()])?);
        statements.push(db.prepare(format!("UPDATE lt_auth_tokens SET session_expires=0,expires=MIN(expires,?4) WHERE email=(SELECT old_email FROM lt_email_changes WHERE id=?3) AND {won}")).bind(&[app.into(),nonce.clone().into(),request_id.clone().into(),now.into()])?);
        statements.push(db.prepare(format!("UPDATE lt_email_change_tokens SET expires=MIN(expires,?4) WHERE request_id=?3 AND {won}")).bind(&[app.into(),nonce.clone().into(),request_id.clone().into(),now.into()])?);
        for suffix in ["old", "new"] {
            statements.push(db.prepare(format!("INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT ?4,?4,?1,'emailChanged',{},expires FROM lt_email_changes WHERE id=?3 AND {won}",if suffix=="old"{"old_email"}else{"new_email"})).bind(&[app.into(),nonce.clone().into(),request_id.clone().into(),format!("email-confirm:{nonce}:{suffix}").into()])?);
        }
    }
    statements.push(db.prepare(format!("INSERT INTO lt_email_change_operations(actor,operation_id,payload_hash,application_id,request_id,expires) SELECT ?3,?4,?5,?1,?6,e.private_expires FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1 AND a.email_fence=?2")).bind(&[app.into(),nonce.clone().into(),actor.into(),op.clone().into(),payload.clone().into(),request_id.clone().into()])?);
    statements.push(db.prepare(format!("INSERT INTO lt_email_change_audit(id,request_id,application_id,event_id,actor,action,occurred_at,expires) SELECT ?2,?3,?1,a.event_id,?4,?5,?6,e.private_expires FROM lt_applications a JOIN lt_events e ON e.id=a.event_id WHERE a.id=?1 AND a.email_fence=?2")).bind(&[app.into(),nonce.into(),request_id.clone().into(),actor.into(),action.into(),instant(&json!(now)).as_str().unwrap().into()])?);
    let result = db.batch(statements).await?;
    if result[0].meta()?.and_then(|m| m.changes).unwrap_or(0) == 0 {
        if let Some(r) = replay(db, app, actor, &op, &payload, rid).await? {
            return Ok(r);
        }
        let duplicate=db.prepare("SELECT id FROM lt_applications WHERE event_id=?1 AND email=?2 AND id!=?3 AND active=1").bind(&[parent["event_id"].as_str().unwrap().into(),new_email.clone().into(),app.into()])?.all().await?.results::<Value>()?;
        return error(
            if duplicate.is_empty() {
                "VERSION_CONFLICT"
            } else {
                "DUPLICATE_APPLICATION"
            },
            409,
            rid,
        );
    }
    if action == "send-verification" {
        crate::mail::dispatch(env, db, origin, lt_mail::Outcome::Accepted, 1).await?;
    }
    // commit直後に別の調査が開始されても、mutation成功としてnullを返さない
    let dto = current(db, app, &request_id).await?;
    if dto.is_null() {
        error("VERSION_CONFLICT", 409, rid)
    } else {
        Response::from_json(&dto)
    }
}

/// 新アドレス確認tokenを一度だけ交換する。login sessionは作らない
/// 引数: DB、平文token（保存しない）
/// 戻り値: acceptedまたは固定tokenエラー
pub async fn verify(db: &D1Database, token: &str) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    let rows=db.prepare("UPDATE lt_email_change_tokens SET used=1 WHERE hash=?1 AND purpose='email_change' AND used=0 AND expires>MAX(?2,COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)) AND EXISTS(SELECT 1 FROM lt_email_changes r JOIN lt_applications a ON a.id=r.application_id JOIN lt_events e ON e.id=r.event_id WHERE r.id=lt_email_change_tokens.request_id AND r.current=1 AND r.token_hash=lt_email_change_tokens.hash AND r.state='verificationPending' AND a.email=r.old_email AND e.publish_enabled=1 AND e.state IN('scheduled','started','ended') AND (e.private_expires IS NULL OR e.private_expires>MAX(?2,COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)))) RETURNING hash").bind(&[hash(token).into(),now.into()])?.all().await?.results::<Value>()?;
    if rows.is_empty() {
        error("TOKEN_INVALID", 400, "email-change")
    } else {
        Response::from_json(&json!({"accepted":true}))
    }
}
