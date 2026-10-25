use serde_json::Value;
use worker::*;

/// 異種操作race用ビルドだけで読取済み時刻を記録し短時間待機する
/// 引数: 認証済みrequest、読取済みDTO
/// 戻り値: 観測した公開時刻（通常ビルドには存在しない）
pub async fn pause(req: &Request, dto: &Value) -> Result<Option<String>> {
    if req.headers().get("X-LT-Test-Pause")?.as_deref() != Some("after-read") {
        return Ok(None);
    }
    let value = dto["published"]["startsAt"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    Delay::from(std::time::Duration::from_millis(700)).await;
    Ok(Some(value))
}

/// テストで観測した読取値を応答ヘッダーへ付ける
/// 引数: 応答、観測値
/// 戻り値: 試験専用観測付き応答
pub fn annotate(mut response: Response, value: Option<String>) -> Result<Response> {
    if let Some(value) = value {
        response
            .headers_mut()
            .set("X-LT-Test-Observed-Start", &value)?;
    }
    Ok(response)
}

/// 試験専用ポートからだけfake mailboxを取得する
/// 引数: 架空recipient、内部環境
/// 戻り値: 期限内のfake確認link（ログへは出力しない）
#[worker::wasm_bindgen::prelude::wasm_bindgen]
pub async fn fake_mail(
    email: String,
    env: Env,
) -> std::result::Result<String, worker::wasm_bindgen::JsValue> {
    use worker::wasm_bindgen::JsValue;
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
    let now = crate::lifecycle::reconcile(&db)
        .await
        .map_err(|_| JsValue::from_str("Fake mailbox unavailable"))?;
    let rows=db.prepare("SELECT o.action_url FROM lt_login_outbox o JOIN lt_mail_jobs j ON j.id='authentication:'||o.id WHERE o.recipient=?1 AND o.expires>?2 AND o.action_url!='' AND j.transport='fake' AND j.delivered_at IS NOT NULL AND EXISTS(SELECT 1 FROM lt_mail_mode WHERE id=1 AND mode='fake') ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1").bind(&[email.into(),now.into()]).map_err(|_|JsValue::from_str("Fake mailbox unavailable"))?.all().await.map_err(|_|JsValue::from_str("Fake mailbox unavailable"))?.results::<Value>().map_err(|_|JsValue::from_str("Fake mailbox unavailable"))?;
    rows.first()
        .and_then(|r| r["action_url"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| JsValue::from_str("Fake mailbox empty"))
}

/// ローカル検証専用の時計を設定する
/// 引数: 正規化UTC時刻または real、ローカル環境
/// 戻り値: 設定完了。通常ビルドには公開しない
#[worker::wasm_bindgen::prelude::wasm_bindgen]
pub async fn set_clock(
    value: String,
    env: Env,
) -> std::result::Result<(), worker::wasm_bindgen::JsValue> {
    use worker::wasm_bindgen::JsValue;
    if !cfg!(feature = "local-development")
        || env
            .var("LOCAL_AUTH")
            .map(|v| v.to_string())
            .unwrap_or_default()
            != "true"
    {
        return Err(JsValue::from_str("Disabled"));
    }
    let ms = if value == "real" {
        None
    } else {
        if value.len() != 24 || !value.ends_with('Z') {
            return Err(JsValue::from_str("Invalid clock"));
        }
        Some(
            chrono::DateTime::parse_from_rfc3339(&value)
                .map_err(|_| JsValue::from_str("Invalid clock"))?
                .timestamp_millis() as f64,
        )
    };
    let db = env
        .d1("DB")
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    db.prepare("UPDATE lt_clock SET now_ms=?1 WHERE id=1")
        .bind(&[ms.map(JsValue::from).unwrap_or(JsValue::NULL)])
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        .run()
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(())
}

/// 検証bundleだけでfakeの失敗分類を選択する
/// 引数: 固定fake結果、ローカル環境
/// 戻り値: 配送完了件数。公開fetchには登録しない
#[worker::wasm_bindgen::prelude::wasm_bindgen]
pub async fn test_dispatch(
    outcome: String,
    env: Env,
) -> std::result::Result<u32, worker::wasm_bindgen::JsValue> {
    use worker::wasm_bindgen::JsValue;
    if !cfg!(feature = "local-development")
        || env
            .var("LOCAL_AUTH")
            .map(|v| v.to_string())
            .unwrap_or_default()
            != "true"
    {
        return Err(JsValue::from_str("Disabled"));
    }
    let outcome = match outcome.as_str() {
        "accepted" => lt_mail::Outcome::Accepted,
        "temporary" => lt_mail::Outcome::Temporary,
        "permanent" => lt_mail::Outcome::Permanent,
        "uncertain" => lt_mail::Outcome::Uncertain,
        _ => return Err(JsValue::from_str("Invalid fake outcome")),
    };
    let db = env
        .d1("DB")
        .map_err(|_| JsValue::from_str("Mail unavailable"))?;
    crate::lifecycle::reconcile(&db)
        .await
        .map_err(|_| JsValue::from_str("Mail unavailable"))?;
    let origin = env
        .var("APP_ORIGIN")
        .map_err(|_| JsValue::from_str("Mail unavailable"))?
        .to_string();
    crate::mail::dispatch(&db, &origin, outcome, 1)
        .await
        .map_err(|_| JsValue::from_str("Mail unavailable"))
}

/// 架空DBだけで削除batchを試験する
#[worker::wasm_bindgen::prelude::wasm_bindgen]
pub async fn retention_test(
    env: Env,
    input: String,
) -> std::result::Result<String, worker::wasm_bindgen::JsValue> {
    let run = async {
        if !cfg!(feature = "local-development") || env.var("LOCAL_AUTH")?.to_string() != "true" {
            return Err(Error::RustError("Disabled".into()));
        }
        let v: Value = serde_json::from_str(&input)?;
        let db = env.d1("DB")?;
        if v["snapshot"] == true {
            let inventory: Value =
                serde_json::from_str(include_str!("../retention/d1-inventory.json"))?;
            let mut queries = Vec::new();
            for name in inventory.as_object().unwrap().keys() {
                queries.push(db.prepare(format!("SELECT count(*) AS n FROM {name}")));
            }
            let values = db.batch(queries).await?;
            let counts = values
                .into_iter()
                .map(|r| r.results::<Value>().map(|v| v[0]["n"].clone()))
                .collect::<Result<Vec<_>>>()?;
            return Ok(serde_json::to_string(&counts)?);
        }
        if v["authOnly"] == true {
            return Ok(crate::retention::clean_auth(
                &db,
                v["delete"] == true,
                v["failAfter"].as_u64().map(|n| n as usize),
            )
            .await?
            .to_string());
        }
        let result = crate::retention::sweep(
            &db,
            v["eventId"]
                .as_str()
                .ok_or_else(|| Error::RustError("Invalid".into()))?,
            v["delete"] == true,
            v["failAfter"].as_u64().map(|n| n as usize),
        )
        .await?;
        Ok::<String, Error>(result.to_string())
    };
    run.await
        .map_err(|_| worker::wasm_bindgen::JsValue::from_str("Retention refused"))
}

/// 検証ポートだけで配送済みメール変更linkを取得する
/// 引数: 架空の宛先、ローカル環境
/// 戻り値: 確認link。CLI/logへは出さない
#[worker::wasm_bindgen::prelude::wasm_bindgen]
pub async fn change_mail(
    email: String,
    env: Env,
) -> std::result::Result<String, worker::wasm_bindgen::JsValue> {
    use worker::wasm_bindgen::JsValue;
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
        .map_err(|_| JsValue::from_str("Mailbox unavailable"))?;
    let now = crate::lifecycle::reconcile(&db)
        .await
        .map_err(|_| JsValue::from_str("Mailbox unavailable"))?;
    let rows=db.prepare("SELECT p.action_url FROM lt_email_change_payloads p JOIN lt_outbox o ON o.id=p.outbox_id JOIN lt_mail_jobs j ON j.id='application:'||o.id JOIN lt_email_change_tokens t ON t.hash=p.token_hash JOIN lt_email_changes r ON r.id=t.request_id WHERE o.recipient=?1 AND t.expires>?2 AND t.used=0 AND r.current=1 AND p.action_url!='' AND j.transport='fake' AND j.delivered_at IS NOT NULL AND EXISTS(SELECT 1 FROM lt_mail_mode WHERE id=1 AND mode='fake') ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1").bind(&[email.into(),now.into()]).map_err(|_|JsValue::from_str("Mailbox unavailable"))?.all().await.map_err(|_|JsValue::from_str("Mailbox unavailable"))?.results::<Value>().map_err(|_|JsValue::from_str("Mailbox unavailable"))?;
    rows.first()
        .and_then(|r| r["action_url"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| JsValue::from_str("Mailbox empty"))
}
