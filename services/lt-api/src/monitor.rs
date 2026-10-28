use serde_json::{Value, json};
use worker::*;

/// 要対応事項と定期処理・配送の現在状態を読み取る
///
/// # 引数
/// - `db`: LT専用データベース
/// - `env`: 定期処理と配送の設定
///
/// # 戻り値
/// 個人情報や配送先を含まない運営用の状態
///
/// # エラー
/// データベースの読み取りに失敗した場合
pub async fn snapshot(db: &D1Database, env: &Env) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    // 状態参照ではreconcileやheartbeatの更新を行わず、停止を隠さない
    let rows = db.batch(vec![
        db.prepare(include_str!("attention.sql")).bind(&[now.into()])?,
        db.prepare("SELECT started_at AS startedAt,completed_at AS completedAt,succeeded_at AS succeededAt,outcome FROM lt_maintenance_status WHERE id=1"),
        db.prepare("SELECT mode FROM lt_mail_mode WHERE id=1"),
        db.prepare("SELECT j.state,count(*) AS count FROM lt_mail_jobs j JOIN lt_mail_outbox o ON o.id=j.id WHERE j.expires>?1 AND o.state='pending' AND (o.expires IS NULL OR o.expires>?1*1000) GROUP BY j.state").bind(&[(now / 1000.0).into()])?,
        db.prepare("SELECT count(*) AS count,MIN(o.created_at) AS oldestAt FROM lt_mail_outbox o LEFT JOIN lt_mail_jobs j ON j.id=o.id WHERE o.state='pending' AND (o.expires IS NULL OR o.expires>?1) AND o.created_at>?1-86400000 AND (j.id IS NULL OR j.state='pending' OR j.state='leased')").bind(&[now.into()])?,
    ]).await?;
    let heartbeat = rows[1]
        .results::<Value>()?
        .into_iter()
        .next()
        .unwrap_or(Value::Null);
    let mode = rows[2]
        .results::<Value>()?
        .into_iter()
        .next()
        .unwrap_or(Value::Null);
    let backlog = rows[4]
        .results::<Value>()?
        .into_iter()
        .next()
        .unwrap_or(Value::Null);
    let enabled = crate::gate::private_enabled(env)
        && env
            .var("LT_MAINTENANCE_ENABLED")
            .map(|v| v.to_string())
            .unwrap_or_default()
            == "true";
    let status = if !enabled {
        "disabled"
    } else if heartbeat["startedAt"]
        .as_f64()
        .is_none_or(|time| now - time > 300_000.0)
    {
        "stale"
    } else if heartbeat["outcome"] == "failed" {
        "failed"
    } else if heartbeat["succeededAt"]
        .as_f64()
        .is_none_or(|time| now - time > 300_000.0)
    {
        "stale"
    } else {
        "ok"
    };
    Response::from_json(&json!({
        "checkedAt":now,"maintenance":{"status":status,"enabled":enabled,"heartbeat":heartbeat},
        "mail":{"mode":mode["mode"],"states":rows[3].results::<Value>()?,"backlog":backlog,
            "configured":env.var("LT_MAIL_RELAY_URL").is_ok() && env.secret("LT_MAIL_RELAY_TOKEN").is_ok(),
            "testRecipientOnly":env.var("LT_MAIL_TEST_RECIPIENT").is_ok_and(|v| !v.to_string().is_empty())},
        "items":rows[0].results::<Value>()?
    }))
}
