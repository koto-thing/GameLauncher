use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::wasm_bindgen::JsCast;
use worker::*;

/// 秘密値の SHA-256 を生成する
/// 引数: 秘密値
/// 戻り値: 保存用ハッシュ
fn hash(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 暗号学的乱数を生成する
/// 引数: なし
/// 戻り値: 256 bit の token
pub(crate) fn secret() -> Result<String> {
    let crypto = js_sys::Reflect::get(&js_sys::global(), &"crypto".into())?
        .unchecked_into::<web_sys::Crypto>();
    let mut bytes = [0u8; 32];
    crypto.get_random_values_with_u8_array(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// 契約エラーを生成する
/// 引数: コード、HTTP status
/// 戻り値: 値を漏らさない応答
fn error(code: &str, status: u16) -> Result<Response> {
    Ok(
        Response::from_json(&json!({"error":{"code":code,"requestId":"applicant"}}))?
            .with_status(status),
    )
}

/// オブジェクトの入力キーを検証する
/// 引数: JSON、必須キー、任意キー
/// 戻り値: 形式が正しいか
fn object(v: &Value, required: &[&str], optional: &[&str]) -> bool {
    v.as_object().is_some_and(|o| {
        required.iter().all(|k| o.contains_key(*k))
            && o.keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str()))
    })
}

/// 非空文字列を検証する
/// 引数: JSON 値
/// 戻り値: 検証結果
fn text(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.trim().is_empty())
}

/// 発表入力を共有契約に従って検証する
/// 引数: 本文と資料 URL
/// 戻り値: 検証結果
fn content(v: &Value, url: &Value) -> bool {
    object(v, &["title", "abstract", "speakers"], &["description"])
        && text(&v["title"])
        && text(&v["abstract"])
        && (v.get("description").is_none() || text(&v["description"]))
        && v["speakers"].as_array().is_some_and(|a| {
            !a.is_empty()
                && a.iter().all(|s| {
                    object(s, &["displayName"], &["affiliation", "profile"])
                        && text(&s["displayName"])
                        && ["affiliation", "profile"]
                            .iter()
                            .all(|k| s.get(*k).is_none() || text(&s[*k]))
                })
        })
        && url.as_str().is_some_and(|s| {
            Url::parse(s).is_ok_and(|u| {
                ["https", "http"].contains(&u.scheme())
                    && u.host_str().is_some()
                    && u.username().is_empty()
                    && u.password().is_none()
            })
        })
}

/// 本人 API をローカル開発機能として処理する
/// 引数: リクエスト、環境
/// 戻り値: 対象の場合は応答、それ以外は None
pub async fn handle(req: &mut Request, env: &Env) -> Result<Option<Response>> {
    let path = req.path();
    if !path.starts_with("/api/lt/v1/auth/")
        && !path.starts_with("/api/lt/v1/applications")
        && path != "/auth/verify"
    {
        return Ok(None);
    }
    // 開発機能を本番 bundle では有効化しない
    if !cfg!(feature = "local-development")
        || env
            .var("LOCAL_AUTH")
            .map(|v| v.to_string())
            .unwrap_or_default()
            != "true"
    {
        return Ok(Some(Response::error("Not implemented", 501)?));
    }
    let origin = env.var("APP_ORIGIN")?.to_string();
    let now = Date::now().as_millis() as f64;
    let db = env.d1("DB")?;
    // GET 確認は token を読まず消費しない。ブラウザーが明示 POST する
    if path == "/auth/verify" && req.method() == Method::Get {
        return Ok(Some(Response::from_html(
            "<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><title>メール確認</title><button id=\"verify\">確認する</button><p id=\"result\"></p><script>const token=new URL(location.href).searchParams.get('token');history.replaceState(null,'','/auth/verify');document.getElementById('verify').onclick=async()=>{const r=await fetch('/api/lt/v1/auth/verify',{method:'POST',headers:{'Content-Type':'application/json','X-LT-CSRF':'1'},body:JSON.stringify({token})});document.getElementById('result').textContent=r.ok?'確認しました':'確認できませんでした';};</script></html>",
        )?));
    }
    // cookie 認証の変更操作には同一 Origin と非 simple header を要求
    if req.method() != Method::Get
        && (req.headers().get("Origin")?.as_deref() != Some(&origin)
            || req.headers().get("X-LT-CSRF")?.as_deref() != Some("1")
            || !req
                .headers()
                .get("Content-Type")?
                .unwrap_or_default()
                .starts_with("application/json"))
    {
        return Ok(Some(error("FORBIDDEN", 403)?));
    }
    if path == "/api/lt/v1/auth/email" && req.method() == Method::Post {
        let v: Value = match crate::input::json(req).await {
            Ok(v) => v,
            Err(_) => return Ok(Some(error("VALIDATION", 422)?)),
        };
        if !object(&v, &["email"], &[])
            || !v["email"].as_str().is_some_and(|s| {
                s.len() <= 254
                    && s.split('@').count() == 2
                    && !s.chars().any(char::is_whitespace)
                    && s.split('@').all(|p| !p.is_empty())
            })
        {
            return Ok(Some(error("VALIDATION", 422)?));
        }
        let email = v["email"].as_str().unwrap().to_lowercase();
        let bucket = (now / 3600000.0).floor();
        let rate=db.prepare("INSERT INTO lt_auth_rate VALUES(?1,?2,1) ON CONFLICT(email_hash,bucket) DO UPDATE SET count=count+1 RETURNING count").bind(&[hash(&email).into(),bucket.into()])?.all().await?.results::<Value>()?;
        if rate[0]["count"].as_i64().unwrap_or(99) > 5 {
            return Ok(Some(error("RATE_LIMITED", 429)?));
        }
        let token = secret()?;
        let expires = now + 3600000.0;
        db.batch(vec![
            db.prepare(
                "INSERT INTO lt_auth_tokens(hash,email,purpose,expires) VALUES(?1,?2,'login',?3)",
            )
            .bind(&[hash(&token).into(), email.clone().into(), expires.into()])?,
            db.prepare("INSERT INTO lt_fake_mail VALUES(?1,?2,?3,?4)")
                .bind(&[
                    secret()?.into(),
                    email.into(),
                    format!("{origin}/auth/verify?token={token}").into(),
                    expires.into(),
                ])?,
        ])
        .await?;
        return Ok(Some(
            Response::from_json(&json!({"accepted":true}))?.with_status(202),
        ));
    }
    if path == "/api/lt/v1/auth/verify" && req.method() == Method::Post {
        let v: Value = match crate::input::json(req).await {
            Ok(v) => v,
            Err(_) => return Ok(Some(error("TOKEN_INVALID", 400)?)),
        };
        if !object(&v, &["token"], &[]) || !text(&v["token"]) {
            return Ok(Some(error("TOKEN_INVALID", 400)?));
        }
        let session = secret()?;
        let hours = env
            .var("SESSION_HOURS")?
            .to_string()
            .parse::<u32>()
            .unwrap_or(24)
            .clamp(1, 24);
        let expires = now + (hours as f64) * 3600000.0;
        // 条件付き単一 UPDATE が消費と session 発行を原子的に行う
        let rows=db.prepare("UPDATE lt_auth_tokens SET session_hash=?1,session_expires=?2 WHERE hash=?3 AND purpose='login' AND expires>?4 AND session_hash IS NULL RETURNING email").bind(&[hash(&session).into(),expires.into(),hash(v["token"].as_str().unwrap()).into(),now.into()])?.all().await?.results::<Value>()?;
        if rows.is_empty() {
            return Ok(Some(error("TOKEN_INVALID", 400)?));
        }
        let date = js_sys::Date::new(&expires.into())
            .to_iso_string()
            .as_string()
            .unwrap();
        let mut r = Response::from_json(&json!({"expiresAt":date}))?;
        r.headers_mut().set("Set-Cookie",&format!("__Host-lt_session={session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={}",hours*3600))?;
        return Ok(Some(r));
    }
    let cookie = req.headers().get("Cookie")?.unwrap_or_default();
    let session = cookie
        .split(';')
        .find_map(|p| p.trim().strip_prefix("__Host-lt_session="))
        .unwrap_or("");
    let rows=db.prepare("SELECT email,session_expires FROM lt_auth_tokens WHERE session_hash=?1 AND session_expires>?2").bind(&[hash(session).into(),now.into()])?.all().await?.results::<Value>()?;
    if path == "/api/lt/v1/auth/session" && req.method() == Method::Get {
        let value = if let Some(r) = rows.first() {
            json!({"expiresAt":js_sys::Date::new(&r["session_expires"].as_f64().unwrap().into()).to_iso_string().as_string().unwrap()})
        } else {
            Value::Null
        };
        return Ok(Some(Response::from_json(&value)?));
    }
    let Some(owner) = rows.first().and_then(|r| r["email"].as_str()) else {
        return Ok(Some(error("UNAUTHENTICATED", 401)?));
    };
    if path == "/api/lt/v1/auth/logout" && req.method() == Method::Post {
        db.prepare("UPDATE lt_auth_tokens SET session_expires=0 WHERE session_hash=?1")
            .bind(&[hash(session).into()])?
            .run()
            .await?;
        let mut r = Response::empty()?.with_status(204);
        r.headers_mut().set(
            "Set-Cookie",
            "__Host-lt_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
        )?;
        return Ok(Some(r));
    }
    if path.starts_with("/api/lt/v1/applications") {
        return Ok(Some(applications(req, &db, owner, now).await?));
    }
    Ok(Some(Response::error("Not implemented", 501)?))
}

/// 所有者を検証して本人申請を取得する
/// 引数: リクエスト、DB、認証済みメール、現在時刻
/// 戻り値: 本人だけの申請 DTO
async fn applications(
    req: &mut Request,
    db: &D1Database,
    owner: &str,
    now: f64,
) -> Result<Response> {
    let path = req.path();
    let p: Vec<_> = path.trim_matches('/').split('/').collect();
    if req.method() == Method::Get {
        let mut stmt = db.prepare(if p.len() == 4 {
            "SELECT dto FROM lt_applications WHERE email=?1 ORDER BY id"
        } else {
            "SELECT dto FROM lt_applications WHERE email=?1 AND id=?2"
        });
        stmt = if p.len() == 4 {
            stmt.bind(&[owner.into()])?
        } else {
            stmt.bind(&[owner.into(), p[4].into()])?
        };
        let rows = stmt.all().await?.results::<Value>()?;
        let items: Vec<Value> = rows
            .iter()
            .map(|r| serde_json::from_str(r["dto"].as_str().unwrap()).unwrap())
            .collect();
        let active: Vec<Value> = items
            .iter()
            .filter(|v| !expired(v, now))
            .filter_map(crate::applicant_dto::sanitize)
            .collect();
        return if p.len() == 4 {
            Response::from_json(&json!({"items":active,"nextCursor":null}))
        } else if let Some(v) = items.first() {
            if expired(v, now) {
                error("RETENTION_EXPIRED", 410)
            } else {
                Response::from_json(
                    &crate::applicant_dto::sanitize(v)
                        .ok_or_else(|| Error::RustError("Invalid applicant DTO".into()))?,
                )
            }
        } else {
            error("NOT_FOUND", 404)
        };
    }
    let v: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422),
    };
    let submit = req.method() == Method::Post && p.len() == 4;
    let edit = req.method() == Method::Patch && p.len() == 5;
    let action = if req.method() == Method::Post && p.len() == 6 {
        p[5]
    } else {
        ""
    };
    let transition = [
        "resubmit",
        "withdraw",
        "request-withdrawal",
        "cancel-withdrawal",
    ]
    .contains(&action);
    if !submit && !edit && !transition {
        return Response::error("Not implemented", 501);
    }
    let data = if submit { &v } else { &v["data"] };
    if !(if submit {
        object(
            &v,
            &["eventId", "content", "materialUrl", "operationId"],
            &[],
        ) && text(&v["eventId"])
    } else {
        object(&v, &["expectedVersion", "operationId", "data"], &[])
            && v["expectedVersion"].as_u64().is_some_and(|n| n > 0)
            && if edit {
                object(data, &["content", "materialUrl"], &[])
            } else {
                object(data, &[], &[])
            }
    }) || !text(&v["operationId"])
        || ((submit || edit) && !content(&data["content"], &data["materialUrl"]))
    {
        return error("VALIDATION", 422);
    }
    let op = v["operationId"].as_str().unwrap();
    let payload = hash(&format!("{}:{path}:{}", req.method(), v));
    let replay=db.prepare("SELECT payload_hash,result FROM lt_applicant_operations WHERE EXISTS(SELECT 1 FROM lt_applications a WHERE a.id=lt_applicant_operations.application_id AND (json_extract(a.dto,'$.retentionExpiresAt') IS NULL OR json_extract(a.dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AND actor=?1 AND operation_id=?2 AND (expires IS NULL OR expires>CAST(unixepoch('subsec')*1000 AS INTEGER))").bind(&[owner.into(),op.into()])?.all().await?.results::<Value>()?;
    if let Some(r) = replay.first() {
        return if r["payload_hash"] == payload {
            Response::from_json(
                &crate::applicant_dto::sanitize(&serde_json::from_str::<Value>(
                    r["result"].as_str().unwrap(),
                )?)
                .ok_or_else(|| Error::RustError("Invalid applicant DTO".into()))?,
            )
        } else {
            error("VERSION_CONFLICT", 409)
        };
    }
    if submit {
        let event = v["eventId"].as_str().unwrap();
        let duplicate = db
            .prepare("SELECT id FROM lt_applications WHERE email=?1 AND event_id=?2 AND active=1")
            .bind(&[owner.into(), event.into()])?
            .all()
            .await?
            .results::<Value>()?;
        if !duplicate.is_empty() {
            if let Some(response) =
                crate::receipts::response(db, "applicant", owner, op, &payload, "applicant").await?
            {
                return Ok(response);
            }

            return error("DUPLICATE_APPLICATION", 409);
        }
        let id = secret()?;
        let date = js_sys::Date::new(&now.into())
            .to_iso_string()
            .as_string()
            .unwrap();
        let dto = json!({"id":id,"eventId":event,"version":1,"content":data["content"],"materialUrl":data["materialUrl"],"representativeEmail":owner,"review":"pending","withdrawal":"none","firstSubmittedAt":date,"everApproved":false,"slotReserved":false,"retentionExpiresAt":null,"published":null});
        // 同一 batch の後続は勝った operation を持つ申請だけに従属する
        let inserted=db.batch(vec![db.prepare("INSERT INTO lt_applications(id,event_id,email,version,dto,operation_id,payload_hash) SELECT ?1,?2,?3,1,?4,?5,?6 FROM lt_recruitment r JOIN lt_events e ON e.id=r.event_id WHERE r.event_id=?2 AND e.publish_enabled=1 AND e.state='scheduled' AND r.opens<=?7 AND r.closes>?7 AND r.reserved<r.capacity AND NOT EXISTS(SELECT 1 FROM lt_applications WHERE event_id=?2 AND email=?3 AND active=1) ON CONFLICT DO NOTHING").bind(&[id.clone().into(),event.into(),owner.into(),dto.to_string().into(),op.into(),payload.clone().into(),now.into()])?,db.prepare("INSERT INTO lt_applicant_operations(actor,operation_id,payload_hash,application_id,result) SELECT email,operation_id,payload_hash,id,dto FROM lt_applications WHERE id=?1 AND operation_id=?2 ON CONFLICT DO NOTHING").bind(&[id.into(),op.into()])?]).await?;
        if inserted[0].meta()?.unwrap().changes.unwrap_or(0) == 0 {
            if let Some(response) =
                crate::receipts::response(db, "applicant", owner, op, &payload, "applicant").await?
            {
                return Ok(response);
            }

            let duplicates = db
                .prepare(
                    "SELECT id FROM lt_applications WHERE event_id=?1 AND email=?2 AND active=1",
                )
                .bind(&[event.into(), owner.into()])?
                .all()
                .await?
                .results::<Value>()?;
            if !duplicates.is_empty() {
                return error("DUPLICATE_APPLICATION", 409);
            }
            let full=db.prepare("SELECT event_id FROM lt_recruitment WHERE event_id=?1 AND reserved>=capacity AND opens<=?2 AND closes>?2").bind(&[event.into(),now.into()])?.all().await?.results::<Value>()?;
            if !full.is_empty() {
                return error("CAPACITY_FULL", 409);
            }
            return error("RECRUITMENT_CLOSED", 409);
        }
        return Response::from_json(
            &crate::applicant_dto::sanitize(&dto)
                .ok_or_else(|| Error::RustError("Invalid applicant DTO".into()))?,
        );
    }
    let id = p[4];
    let existing = db
        .prepare("SELECT dto FROM lt_applications WHERE id=?1 AND email=?2")
        .bind(&[id.into(), owner.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let Some(old) = existing.first() else {
        return error("NOT_FOUND", 404);
    };
    let mut dto: Value = serde_json::from_str(old["dto"].as_str().unwrap())?;
    if expired(&dto, now) {
        return error("RETENTION_EXPIRED", 410);
    }
    if dto["version"] != v["expectedVersion"] {
        if let Some(response) =
            crate::receipts::response(db, "applicant", owner, op, &payload, "applicant").await?
        {
            return Ok(response);
        }

        return error("VERSION_CONFLICT", 409);
    }
    #[cfg(feature = "runtime-tests")]
    let observed = crate::test_hooks::pause(req, &dto).await?;
    let review = dto["review"].as_str().unwrap_or("");
    let ever = dto["everApproved"] == true;
    let withdrawal = dto["withdrawal"].as_str().unwrap_or("");
    let allowed = if edit {
        (!ever && ["pending", "held"].contains(&review)) || (ever && review == "returned")
    } else {
        match action {
            "resubmit" => review == "returned",
            "withdraw" => !ever && ["pending", "held", "returned", "resubmitted"].contains(&review),
            "request-withdrawal" => ever && withdrawal == "none" && review != "withdrawn",
            "cancel-withdrawal" => withdrawal == "requested",
            _ => false,
        }
    };
    if !allowed {
        return error("INVALID_TRANSITION", 409);
    }
    dto["version"] = json!(v["expectedVersion"].as_u64().unwrap() + 1);
    if edit {
        dto["content"] = data["content"].clone();
        dto["materialUrl"] = data["materialUrl"].clone();
    }
    match action {
        "resubmit" => dto["review"] = json!("resubmitted"),
        "withdraw" => dto["review"] = json!("withdrawn"),
        "request-withdrawal" => dto["withdrawal"] = json!("requested"),
        "cancel-withdrawal" => dto["withdrawal"] = json!("none"),
        _ => {}
    }
    let result=db.batch(vec![db.prepare("UPDATE lt_applications SET version=version+1,dto=json_set(?1,'$.published',json_extract(dto,'$.published')),operation_id=?2,payload_hash=?3,actor_id=NULL,active=CASE WHEN json_extract(?1,'$.review')='withdrawn' THEN 0 ELSE 1 END WHERE id=?4 AND email=?5 AND version=?6 AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_applications.event_id AND (e.state IN ('scheduled','started') OR (e.state='ended' AND json_extract(lt_applications.dto,'$.everApproved')=1 AND json_extract(lt_applications.dto,'$.review')='returned')))").bind(&[dto.to_string().into(),op.into(),payload.clone().into(),id.into(),owner.into(),(v["expectedVersion"].as_u64().unwrap() as f64).into()])?,db.prepare("INSERT INTO lt_applicant_operations(actor,operation_id,payload_hash,application_id,result) SELECT email,operation_id,payload_hash,id,dto FROM lt_applications WHERE id=?1 AND operation_id=?2 ON CONFLICT DO NOTHING").bind(&[id.into(),op.into()])?]).await?;
    if result[0].meta()?.unwrap().changes.unwrap_or(0) == 0 {
        if let Some(response) =
            crate::receipts::response(db, "applicant", owner, op, &payload, "applicant").await?
        {
            return Ok(response);
        }

        return error("VERSION_CONFLICT", 409);
    }
    let saved = db
        .prepare("SELECT dto FROM lt_applications WHERE id=?1 AND email=?2")
        .bind(&[id.into(), owner.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let dto: Value = serde_json::from_str(saved[0]["dto"].as_str().unwrap())?;
    let response = Response::from_json(
        &crate::applicant_dto::sanitize(&dto)
            .ok_or_else(|| Error::RustError("Invalid applicant DTO".into()))?,
    )?;
    #[cfg(feature = "runtime-tests")]
    let response = crate::test_hooks::annotate(response, observed)?;
    Ok(response)
}

/// 私有申請の固定保持期限を判定する
/// 引数: 申請、現在のミリ秒
/// 戻り値: 期限切れか
pub(crate) fn expired(dto: &Value, now: f64) -> bool {
    dto["retentionExpiresAt"].as_str().is_some_and(|s| {
        let millis = js_sys::Date::new(&s.into()).get_time();
        !millis.is_finite() || millis <= now
    })
}
