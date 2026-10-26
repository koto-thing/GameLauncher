//! D1保持削除。運用はscheduledの独立gate、故障注入はテストbuildだけで扱う
use serde_json::{Value, json};
use worker::wasm_bindgen::JsValue;
use worker::*;

/// 同一batchで検査するSchemaと不変期限の条件を作る
/// 引数: なし
/// 戻り値: parameter 2=開催ID、3=時刻に対するSQL条件
fn guard() -> String {
    let schema = include_str!("../retention/d1-schema-guard.sql");
    format!(
        "({schema}) AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=?2 AND e.state IN ('ended','cancelled') AND e.private_expires<=?3 AND e.private_expires=CAST(unixepoch(CASE WHEN e.state='ended' THEN e.ended_at ELSE e.cancelled_at END,'+9 hours','+3 months','floor','-9 hours','subsec')*1000 AS INTEGER))"
    )
}

/// 専用架空DBの期限到達回を一つ処理する。既定dry-run
/// 引数: D1、開催ID、破壊処理の明示指定、途中失敗注入位置（試験build専用）
/// 戻り値: 件数だけ。私有データは返さない
async fn sweep_inner(
    db: &D1Database,
    event: &str,
    delete: bool,
    fail_after: Option<usize>,
) -> Result<Value> {
    let _ = fail_after;
    let now = crate::lifecycle::now(db).await?;
    let condition = guard();
    let valid = db
        .prepare(format!(
            "SELECT CASE WHEN {condition} THEN 1 ELSE 0 END AS valid"
        ))
        .bind(&[JsValue::NULL, event.into(), now.into()])?
        .all()
        .await?
        .results::<Value>()?;
    if valid.first().is_none_or(|v| v["valid"] != 1) {
        return Err(Error::RustError("LT_RETENTION_GUARD".into()));
    }
    let count = db
        .prepare("SELECT count(*) AS n FROM lt_applications WHERE event_id=?1")
        .bind(&[event.into()])?
        .all()
        .await?
        .results::<Value>()?;
    if !delete {
        return Ok(json!({"eligible":true,"dryRun":true,"applications":count[0]["n"]}));
    }
    let run = crate::applicant::secret()?;
    let mut sql=vec![format!("INSERT INTO lt_retention_guard SELECT ?1,CASE WHEN {condition} THEN 1 ELSE 0 END,?2,(SELECT state FROM lt_events WHERE id=?2)"),
 "INSERT INTO lt_retention_apps SELECT ?1,id,email FROM lt_applications WHERE event_id=?2".into(),
 "INSERT INTO lt_retention_outbox SELECT ?1,id FROM lt_outbox WHERE application_id IN (SELECT id FROM lt_retention_apps WHERE run_id=?1)".into()];
    // 全DMLを同じD1 batchに閉じる。0行UPDATEを成功guardにしない
    for file in [
        include_str!("../retention/prepare-archive-proposal.sql"),
        include_str!("../retention/delete-email-change.sql"),
        include_str!("../retention/delete-event.sql"),
        include_str!("../retention/d1-mail-cleanup.sql"),
        include_str!("../retention/delete-expired-orphan-auth.sql"),
        include_str!("../retention/delete-expired-rate.sql"),
    ] {
        let text = file
            .lines()
            .filter(|line| !line.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        for statement in text.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            sql.push(
                statement
                    .replace(
                        "retention_due",
                        "(SELECT event_id,kind FROM lt_retention_guard WHERE id=?1)",
                    )
                    .replace(
                        "retention_apps",
                        "(SELECT id,email FROM lt_retention_apps WHERE run_id=?1)",
                    )
                    .replace(
                        "retention_outbox",
                        "(SELECT id FROM lt_retention_outbox WHERE run_id=?1)",
                    )
                    .replace(":now_ms", "?3"),
            );
        }
    }
    sql.extend([
        "DELETE FROM lt_retention_outbox WHERE run_id=?1".into(),
        "DELETE FROM lt_retention_apps WHERE run_id=?1".into(),
        "DELETE FROM lt_retention_guard WHERE id=?1".into(),
    ]);
    let mut commands = Vec::new();
    for (_index, command) in sql.iter().enumerate() {
        // SQLiteの番号付きparameterの最大番号に合わせてbindする
        let max = if command.contains("?3") {
            3
        } else if command.contains("?2") {
            2
        } else {
            1
        };
        let params = [run.clone().into(), event.into(), now.into()];
        commands.push(db.prepare(command.as_str()).bind(&params[..max])?);
        #[cfg(feature = "runtime-tests")]
        if fail_after == Some(_index) {
            commands.push(db.prepare("INSERT INTO lt_retention_guard(id,valid,event_id,kind) VALUES('failure',0,'fixture','ended')"));
        }
    }
    db.batch(commands).await?;
    Ok(json!({"eligible":true,"dryRun":false,"applications":count[0]["n"],"statements":sql.len()}))
}

/// 開催候補がなくても期限切れ孤立認証を独立して掃除する
/// 引数: DB、明示delete、途中失敗注入位置
/// 戻り値: 件数だけ。通常buildからは呼べない
async fn clean_auth_inner(
    db: &D1Database,
    delete: bool,
    fail_after: Option<usize>,
) -> Result<Value> {
    let _ = fail_after;
    let now = crate::lifecycle::now(db).await?;
    let schema = include_str!("../retention/d1-schema-guard.sql");
    let valid = db
        .prepare(format!(
            "SELECT CASE WHEN {schema} THEN 1 ELSE 0 END AS valid"
        ))
        .all()
        .await?
        .results::<Value>()?;
    if valid.first().is_none_or(|v| v["valid"] != 1) {
        return Err(Error::RustError("LT_RETENTION_GUARD".into()));
    }
    if !delete {
        return Ok(json!({"dryRun":true,"authOnly":true}));
    }
    let run = crate::applicant::secret()?;
    let mut sql = vec![format!(
        "INSERT INTO lt_retention_guard SELECT ?1,CASE WHEN {schema} THEN 1 ELSE 0 END,'authentication','authentication'"
    )];
    for file in [
        include_str!("../retention/d1-mail-cleanup.sql"),
        include_str!("../retention/delete-expired-orphan-auth.sql"),
        include_str!("../retention/delete-expired-rate.sql"),
    ] {
        let text = file
            .lines()
            .filter(|line| !line.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        sql.extend(
            text.split(';')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.replace(":now_ms", "?3")),
        );
    }
    sql.push("DELETE FROM lt_retention_guard WHERE id=?1".into());
    let mut commands = Vec::new();
    for (_index, command) in sql.iter().enumerate() {
        let params = [run.clone().into(), JsValue::NULL, now.into()];
        let max = if command.contains("?3") { 3 } else { 1 };
        commands.push(db.prepare(command.as_str()).bind(&params[..max])?);
        #[cfg(feature = "runtime-tests")]
        if fail_after == Some(_index) {
            commands.push(db.prepare("INSERT INTO lt_retention_guard VALUES('failure',0,'authentication','authentication')"));
        }
    }
    db.batch(commands).await?;
    Ok(json!({"dryRun":false,"authOnly":true,"statements":sql.len()}))
}

/// テスト用入口はローカルの架空DBに限定する
/// 引数: DB、開催ID、削除指定、故障注入位置
/// 戻り値: 件数のみの検証結果
#[cfg(feature = "runtime-tests")]
pub async fn sweep(
    db: &D1Database,
    event: &str,
    delete: bool,
    fail_after: Option<usize>,
) -> Result<Value> {
    if !cfg!(feature = "local-development") {
        return Err(Error::RustError("LT_RETENTION_DISABLED".into()));
    }
    sweep_inner(db, event, delete, fail_after).await
}

/// テスト用の独立認証掃除もローカル限定にする
/// 引数: DB、削除指定、故障注入位置
/// 戻り値: 件数のみの検証結果
#[cfg(feature = "runtime-tests")]
pub async fn clean_auth(db: &D1Database, delete: bool, fail_after: Option<usize>) -> Result<Value> {
    if !cfg!(feature = "local-development") {
        return Err(Error::RustError("LT_RETENTION_DISABLED".into()));
    }
    clean_auth_inner(db, delete, fail_after).await
}

/// 定期処理だけから独立gateを検査して期限到達分を掃除する
/// 引数: 運用環境、専用D1
/// 戻り値: 成否のみ。個人情報や対象IDは返さない
#[cfg(feature = "production-api")]
pub async fn scheduled(env: &Env, db: &D1Database) -> Result<()> {
    if !crate::gate::retention_enabled(env) {
        return Ok(());
    }
    let schema = include_str!("../retention/d1-schema-guard.sql");
    let rows = db
        .prepare(format!(
            "SELECT CASE WHEN {schema} THEN 1 ELSE 0 END AS valid"
        ))
        .all()
        .await?
        .results::<Value>()?;
    if rows.first().is_none_or(|v| v["valid"] != 1) {
        return Err(Error::RustError("LT_RETENTION_GUARD".into()));
    }
    let now = crate::lifecycle::now(db).await?;
    // 削除済みの公開アーカイブは再選択せず、既知の私有子表が残る開催だけを選ぶ
    let candidates = db.prepare("SELECT e.id FROM lt_events e WHERE e.state IN ('ended','cancelled') AND e.private_expires<=?1 AND (EXISTS(SELECT 1 FROM lt_event_configs x WHERE x.id=e.id) OR EXISTS(SELECT 1 FROM lt_applications x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_recruitment x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_schedule x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_event_operations x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_schedule_operations x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_event_cancellations x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_approval_receipts x WHERE x.event_id=e.id) OR e.cancel_actor IS NOT NULL OR e.cancel_operation IS NOT NULL OR e.cancel_hash IS NOT NULL OR (e.state='cancelled' AND (EXISTS(SELECT 1 FROM lt_public_events x WHERE x.event_id=e.id) OR EXISTS(SELECT 1 FROM lt_public_talks x WHERE x.event_id=e.id)))) ORDER BY e.private_expires,e.id LIMIT 1").bind(&[now.into()])?.all().await?.results::<Value>()?;
    if let Some(event) = candidates.first().and_then(|v| v["id"].as_str()) {
        sweep_inner(db, event, true, None).await?;
    }
    // 開催候補がなくても、後から失効した認証や配送payloadを残さない
    clean_auth_inner(db, true, None).await?;
    Ok(())
}
