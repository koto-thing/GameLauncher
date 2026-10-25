use worker::*;

/// 通常は実時刻、専用試験buildだけは固定時計を返す
/// 引数: DB
/// 戻り値: UTC epochミリ秒
pub async fn now(db: &D1Database) -> Result<f64> {
    if cfg!(all(
        feature = "runtime-tests",
        feature = "local-development"
    )) {
        let rows = db
            .prepare("SELECT now_ms FROM lt_clock WHERE id=1")
            .all()
            .await?
            .results::<serde_json::Value>()?;
        if let Some(now) = rows.first().and_then(|v| v["now_ms"].as_f64()) {
            return Ok(now);
        }
    }
    Ok(Date::now().as_millis() as f64)
}

/// 開始・終了と固定保持期限を実アクセス前に確定する
/// 引数: DB
/// 戻り値: 使用した現在時刻。cronの到着には依存しない
pub async fn reconcile(db: &D1Database) -> Result<f64> {
    // 通常buildが試験時計を引き継がないようにする
    if !cfg!(all(
        feature = "runtime-tests",
        feature = "local-development"
    )) {
        db.prepare("UPDATE lt_clock SET now_ms=NULL WHERE id=1 AND now_ms IS NOT NULL")
            .run()
            .await?;
    }
    let now = now(db).await?;
    let start = "(SELECT json_extract(p.dto,'$.startsAt') FROM lt_public_events p WHERE p.event_id=lt_events.id)";
    let end = "COALESCE((SELECT json_extract(b.value,'$.endsAt') FROM lt_schedule s,json_each(s.blocks) b WHERE s.event_id=lt_events.id ORDER BY CAST(b.key AS INTEGER) DESC LIMIT 1),(SELECT json_extract(p.dto,'$.startsAt') FROM lt_public_events p WHERE p.event_id=lt_events.id))";
    // 現在の時間割を同じUPDATE内で評価し、途中の時間割変更と競合しても古い終了値を使わない
    let sql = format!(
        "UPDATE lt_events SET state=CASE WHEN unixepoch({end},'subsec')*1000<=?1 THEN 'ended' ELSE 'started' END,ended_at=CASE WHEN unixepoch({end},'subsec')*1000<=?1 THEN {end} ELSE ended_at END,version=version+1 WHERE publish_enabled=1 AND state IN ('scheduled','started') AND ended_at IS NULL AND cancelled_at IS NULL AND ((state='scheduled' AND unixepoch({start},'subsec')*1000<=?1) OR unixepoch({end},'subsec')*1000<=?1)"
    );
    db.prepare(sql).bind(&[now.into()])?.run().await?;
    // 未作成の時間割は0長として扱い、存在しない発表を見込んだ終了時刻を公開しない
    db.prepare("UPDATE lt_public_events SET dto=json_set(dto,'$.endsAt',json_extract(dto,'$.startsAt'),'$.version',json_extract(dto,'$.version')+1) WHERE event_id IN (SELECT e.id FROM lt_events e JOIN lt_schedule s ON s.event_id=e.id WHERE e.publish_enabled=1 AND json_array_length(s.blocks)=0) AND json_extract(dto,'$.endsAt')!=json_extract(dto,'$.startsAt')").run().await?;
    Ok(now)
}
