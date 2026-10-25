//! ローカル架空データ専用のD1保持削除。通常buildは破壊処理を実行しない
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
pub async fn sweep(
    db: &D1Database,
    event: &str,
    delete: bool,
    fail_after: Option<usize>,
) -> Result<Value> {
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
    if !cfg!(all(
        feature = "runtime-tests",
        feature = "local-development"
    )) {
        return Err(Error::RustError("LT_RETENTION_DISABLED".into()));
    }
    let run = crate::applicant::secret()?;
    let mut sql=vec![format!("INSERT INTO lt_retention_guard SELECT ?1,CASE WHEN {condition} THEN 1 ELSE 0 END,?2,(SELECT state FROM lt_events WHERE id=?2)"),
 "INSERT INTO lt_retention_apps SELECT ?1,id,email FROM lt_applications WHERE event_id=?2".into(),
 "INSERT INTO lt_retention_outbox SELECT ?1,id FROM lt_outbox WHERE application_id IN (SELECT id FROM lt_retention_apps WHERE run_id=?1)".into()];
    // 全DMLを同じD1 batchに閉じる。0行UPDATEを成功guardにしない
    for file in [
        include_str!("../retention/prepare-archive-proposal.sql"),
        include_str!("../retention/delete-event.sql"),
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
    for (index, command) in sql.iter().enumerate() {
        // 各statementに同じ3parameterを持たせ、未使用parameterのbind不一致を避ける
        let wrapped = if command.contains("?3") {
            command.clone()
        } else {
            format!(
                "{command} {}",
                if command.contains(" WHERE ") {
                    " AND ?3 IS NOT NULL AND ?2 IS NOT NULL"
                } else {
                    ""
                }
            )
        };
        let max = if wrapped.contains("?3") {
            3
        } else if wrapped.contains("?2") {
            2
        } else {
            1
        };
        let params = [run.clone().into(), event.into(), now.into()];
        commands.push(db.prepare(wrapped).bind(&params[..max])?);
        if fail_after == Some(index) {
            commands.push(db.prepare("INSERT INTO lt_retention_guard(id,valid,event_id,kind) VALUES('failure',0,'fixture','ended')"));
        }
    }
    db.batch(commands).await?;
    Ok(json!({"eligible":true,"dryRun":false,"applications":count[0]["n"],"statements":sql.len()}))
}
