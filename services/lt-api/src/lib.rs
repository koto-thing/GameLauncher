use serde_json::{Value, json};
use worker::*;
mod applicant;
mod applicant_dto;
mod email_change;
mod events;
mod gate;
mod input;
mod lifecycle;
mod mail;
mod materials;
mod monitor;
mod operations;
mod operator;
mod operator_metadata;
mod planning;
mod receipts;
#[cfg(any(feature = "runtime-tests", feature = "production-api"))]
mod retention;
mod schedule_notifications;
mod schedule_rules;
mod session_info;
#[cfg(feature = "runtime-tests")]
mod test_hooks;
mod views;
#[cfg(feature = "runtime-tests")]
pub use test_hooks::{change_mail, fake_mail, retention_test, set_clock, test_dispatch};
mod presentation;
mod timetable;
pub use operator::{fake_dispatch, operator_request};

/// 固定時刻の状態更新と最大1件の配送だけを定期実行する
///
/// # 引数
/// - `_event`: Cloudflareの定期実行イベント
/// - `env`: データベースと運用設定
/// - `_ctx`: 定期実行コンテキスト
///
/// # 戻り値
/// 戻り値なし、失敗は機密情報を含めず記録する
#[cfg(feature = "production-api")]
#[event(scheduled)]
pub async fn scheduled(_event: ScheduledEvent, env: Env, _ctx: ScheduleContext) {
    let maintenance = crate::gate::private_enabled(&env)
        && env
            .var("LT_MAINTENANCE_ENABLED")
            .map(|v| v.to_string())
            .unwrap_or_default()
            == "true";
    let retention = crate::gate::retention_enabled(&env);
    if !maintenance && !retention {
        return;
    }
    let Ok(db) = env.d1("DB") else {
        console_error!("LT maintenance database unavailable");
        return;
    };
    let started = Date::now().as_millis() as f64;
    let result = async {
        db.prepare("UPDATE lt_maintenance_status SET started_at=?1,outcome='running' WHERE id=1")
            .bind(&[started.into()])?
            .run()
            .await?;
        if retention {
            crate::retention::scheduled(&env, &db).await?;
            crate::mail::clean_receipts(&env).await?;
        }
        if maintenance {
            crate::lifecycle::reconcile(&db).await?;
            let origin = env.var("APP_ORIGIN")?.to_string();
            crate::mail::dispatch(&env, &db, &origin, lt_mail::Outcome::Accepted, 1).await?;
        }
        Ok::<(), Error>(())
    }
    .await;
    let outcome = if result.is_ok() { "ok" } else { "failed" };
    let completed = Date::now().as_millis() as f64;
    // 遅れて完了した古い実行が新しい実行記録を上書きしない
    let recorded = async {
        db.prepare("UPDATE lt_maintenance_status SET completed_at=?1,outcome=?2,succeeded_at=CASE WHEN ?2='ok' THEN ?1 ELSE succeeded_at END WHERE id=1 AND started_at=?3")
            .bind(&[completed.into(), outcome.into(), started.into()])?.run().await
    }.await;
    if result.is_err() || recorded.is_err() {
        console_error!("LT maintenance failed");
    }
}

mod public_dto;

/// 公開HTTPを処理し、終了上限などの契約エラーを応答へ変換する
///
/// # 引数
/// - `req`: 公開APIへのHTTPリクエスト
/// - `env`: データベースを含むWorker環境
/// - `_ctx`: Workerの実行コンテキスト
///
/// # 戻り値
/// 公開DTOまたは拒否を示すHTTP応答
///
/// # エラー
/// 契約エラーに変換できない内部処理の失敗
#[event(fetch)]
pub async fn main(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    let p: Vec<_> = path.trim_matches('/').split('/').collect();
    // 運営ルートは公開入口に登録しない
    let private = match applicant::handle(&mut req, &env).await {
        Ok(value) => value,
        Err(error) if error.to_string().contains("LT_FIXED_CONFLICT") => Some(
            Response::from_json(
                &json!({"error":{"code":"FIXED_CONFLICT","requestId":"applicant"}}),
            )?
            .with_status(409),
        ),
        Err(error) if error.to_string().contains("LT_SCHEDULE_FULL") => Some(
            Response::from_json(
                &json!({"error":{"code":"SCHEDULE_FULL","requestId":"applicant"}}),
            )?
            .with_status(409),
        ),
        Err(error) if error.to_string().contains("LT_OPERATION_CONFLICT") => Some(
            Response::from_json(
                &json!({"error":{"code":"VERSION_CONFLICT","requestId":"applicant"}}),
            )?
            .with_status(409),
        ),
        Err(error) if error.to_string().contains("LT_OWNER_MOVED") => Some(
            Response::from_json(&json!({"error":{"code":"NOT_FOUND","requestId":"applicant"}}))?
                .with_status(404),
        ),
        Err(error) if error.to_string().contains("LT_RETENTION_EXPIRED") => Some(
            Response::from_json(
                &json!({"error":{"code":"RETENTION_EXPIRED","requestId":"applicant"}}),
            )?
            .with_status(410),
        ),
        Err(error) => return Err(error),
    };
    let mut response = if let Some(response) = private {
        response
    } else if req.method() == Method::Get && p.starts_with(&["api", "lt", "v1", "events"]) {
        let talk = p.len() == 7 && p[5] == "talks";
        if p.len() != 4 && p.len() != 5 && !talk {
            Response::error("Not found", 404)?
        } else {
            let db = env.d1("DB")?;
            let now = crate::lifecycle::reconcile(&db).await?;
            let sql = if talk {
                "SELECT p.dto FROM lt_public_talks p JOIN lt_events e ON e.id=p.event_id WHERE (p.approval_operation IS NOT NULL AND (p.approval_operation!='lt-archive:v1' OR EXISTS(SELECT 1 FROM lt_archive_markers m WHERE m.talk_id=p.id AND m.event_id=p.event_id AND json(m.snapshot_json)=json(p.dto)))) AND e.publish_enabled=1 AND e.state IN ('scheduled','started','ended') AND e.public_opens_at <= CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER) AND e.id=?1 AND p.id=?2"
            } else if p.len() == 5 {
                "SELECT p.dto,e.state,(SELECT closes FROM lt_recruitment WHERE event_id=e.id) AS closes,(SELECT capacity FROM lt_recruitment WHERE event_id=e.id) AS capacity,(SELECT reserved FROM lt_recruitment WHERE event_id=e.id) AS reserved FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE NOT EXISTS(SELECT 1 FROM json_each(p.dto,'$.schedule') b WHERE json_extract(b.value,'$.kind')='talk' AND NOT EXISTS(SELECT 1 FROM lt_public_talks t WHERE t.id=json_extract(b.value,'$.talkId') AND t.event_id=e.id AND (t.approval_operation IS NOT NULL AND (t.approval_operation!='lt-archive:v1' OR EXISTS(SELECT 1 FROM lt_archive_markers m WHERE m.talk_id=t.id AND m.event_id=t.event_id AND json(m.snapshot_json)=json(t.dto)))))) AND e.publish_enabled=1 AND e.state IN ('scheduled','started','ended') AND e.public_opens_at <= CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER) AND e.id=?1"
            } else {
                "SELECT p.dto,e.state,(SELECT closes FROM lt_recruitment WHERE event_id=e.id) AS closes,(SELECT capacity FROM lt_recruitment WHERE event_id=e.id) AS capacity,(SELECT reserved FROM lt_recruitment WHERE event_id=e.id) AS reserved FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE NOT EXISTS(SELECT 1 FROM json_each(p.dto,'$.schedule') b WHERE json_extract(b.value,'$.kind')='talk' AND NOT EXISTS(SELECT 1 FROM lt_public_talks t WHERE t.id=json_extract(b.value,'$.talkId') AND t.event_id=e.id AND (t.approval_operation IS NOT NULL AND (t.approval_operation!='lt-archive:v1' OR EXISTS(SELECT 1 FROM lt_archive_markers m WHERE m.talk_id=t.id AND m.event_id=t.event_id AND json(m.snapshot_json)=json(t.dto)))))) AND e.publish_enabled=1 AND e.state IN ('scheduled','started','ended') AND e.public_opens_at <= CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER) ORDER BY e.id"
            };
            let mut stmt = db.prepare(sql);
            if talk {
                stmt = stmt.bind(&[p[4].into(), p[6].into()])?;
            } else if p.len() == 5 {
                stmt = stmt.bind(&[p[4].into()])?;
            }
            let rows = stmt.all().await?.results::<Value>()?;
            let mut items = Vec::new();
            for row in rows {
                let mut saved: Value = serde_json::from_str(
                    row["dto"]
                        .as_str()
                        .ok_or_else(|| Error::RustError("Invalid snapshot".into()))?,
                )?;
                // 終了後は募集設定を削除しても受付終了を維持する
                if !talk && row["state"] != "scheduled" {
                    saved["recruitment"] = json!("closed");
                } else if !talk && row["closes"].is_number() {
                    saved["recruitment"] = json!(if row["state"] != "scheduled"
                        || row["closes"].as_f64().unwrap() <= now
                    {
                        "closed"
                    } else if row["reserved"].as_i64() >= row["capacity"].as_i64() {
                        "full"
                    } else {
                        "open"
                    });
                }
                if let Some(dto) = public_dto::validate(&saved, talk) {
                    items.push(dto);
                }
            }
            if p.len() == 4 {
                Response::from_json(&json!({"items":items,"nextCursor":null}))?
            } else if let Some(dto) = items.first() {
                Response::from_json(dto)?
            } else {
                Response::from_json(
                    &json!({"error":{"code":"NOT_FOUND","requestId":"public-read"}}),
                )?
                .with_status(404)
            }
        }
    } else if path.starts_with("/api/lt/v1/operator/") {
        Response::from_json(&json!({"error":{"code":"NOT_FOUND","requestId":"public"}}))?
            .with_status(404)
    } else {
        Response::from_json(&json!({"error":{"code":"NOT_IMPLEMENTED","requestId":"public"}}))?
            .with_status(501)
    };
    // 全体中止をキャッシュで遅らせない
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("Referrer-Policy", "no-referrer")?;
    Ok(response)
}
