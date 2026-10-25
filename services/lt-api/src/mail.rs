use lt_mail::{
    Outcome,
    runtime::{self, Clock, Envelope, Transport},
};
use serde_json::Value;
use worker::*;

/// 通常は実時計、検証bundleだけAPIと同じ固定時計を使う
/// 引数: DB
/// 戻り値: 信頼済み配送時計
async fn clock(db: &D1Database) -> Result<Clock> {
    #[cfg(all(feature = "runtime-tests", feature = "local-development"))]
    {
        let rows = db
            .prepare("SELECT now_ms FROM lt_clock WHERE id=1")
            .all()
            .await?
            .results::<Value>()?;
        if let Some(now) = rows.first().and_then(|r| r["now_ms"].as_f64()) {
            return Ok(Clock::Fixed((now / 1000.0).floor() as i64));
        }
    }
    let _ = db;
    Ok(Clock::System)
}

/// 期限後の私有送信payloadを論理消去する。保持の物理削除は行わない
/// 引数: DB、現在ミリ秒
/// 戻り値: 更新結果
pub async fn scrub(db: &D1Database, now: f64) -> Result<()> {
    db.prepare("UPDATE lt_email_change_payloads SET action_url='' WHERE action_url!='' AND token_hash IN(SELECT hash FROM lt_email_change_tokens WHERE expires<=?1 OR used=1)").bind(&[now.into()])?.run().await?;
    db.prepare("UPDATE lt_login_outbox SET action_url='' WHERE expires<=?1 AND action_url!=''")
        .bind(&[now.into()])?
        .run()
        .await?;
    db.prepare("UPDATE lt_mail_jobs SET state='expired',envelope='{}',lease_until=NULL WHERE expires<=?1 AND (state!='expired' OR envelope!='{}')").bind(&[(now/1000.0).floor().into()])?.run().await?;
    Ok(())
}

/// 既存の業務/認証outboxから短期限の配送jobを導出する
/// 引数: DB、公開origin、配送時計
/// 戻り値: 投入結果。宛先/linkは返さない
async fn enqueue_pending(db: &D1Database, origin: &str, clock: Clock) -> Result<()> {
    let now = clock.now();
    let rows=db.prepare("SELECT s.* FROM lt_mail_outbox s WHERE state='pending' AND created_at>0 AND (expires IS NULL OR expires>?1) AND NOT EXISTS(SELECT 1 FROM lt_mail_jobs j WHERE j.id=s.id) ORDER BY CASE WHEN kind='emailConfirmation' THEN 0 ELSE 1 END,created_at,id LIMIT 50").bind(&[((now as f64)*1000.0).into()])?.all().await?.results::<Value>()?;
    for row in rows {
        let kind = row["kind"]
            .as_str()
            .ok_or_else(|| Error::RustError("Invalid mail kind".into()))?;
        // 認証は1時間、業務は24時間。固定保持期限が短ければそちらを優先する
        let window = if kind == "emailConfirmation" {
            3600000.0
        } else {
            86400000.0
        };
        let mut deadline = row["created_at"].as_f64().unwrap() + window;
        if let Some(expires) = row["expires"].as_f64() {
            deadline = deadline.min(expires)
        }
        let expires = (deadline / 1000.0).floor() as i64;
        if expires <= now {
            continue;
        }
        let action = if kind == "emailConfirmation" {
            row["action_url"].as_str().unwrap().to_owned()
        } else {
            format!("{origin}/applications")
        };
        if action.is_empty() {
            continue;
        }
        let envelope = Envelope {
            id: row["id"].as_str().unwrap().into(),
            recipient: row["recipient"].as_str().unwrap().into(),
            kind: kind.into(),
            expires,
            action_url: action,
        };
        runtime::enqueue(db, &envelope, clock).await?;
    }
    Ok(())
}

/// fakeと本番経路を排他的にし、単一claim/fenceの経路でだけ配送する
/// 引数: DB、公開origin、fake結果、最大試行数
/// 戻り値: この呼出しがfake配送完了した件数
pub async fn dispatch(db: &D1Database, origin: &str, outcome: Outcome, limit: u32) -> Result<u32> {
    let rows = db
        .prepare("SELECT mode FROM lt_mail_mode WHERE id=1")
        .all()
        .await?
        .results::<Value>()?;
    if rows.first().and_then(|r| r["mode"].as_str()) != Some("fake") {
        return Ok(0);
    }
    let clock = clock(db).await?;
    enqueue_pending(db, origin, clock).await?;
    let mut delivered = 0;
    for _ in 0..limit.min(50) {
        let fence = crate::applicant::secret()?;
        if runtime::dispatch_one(db, &Transport::Fake(outcome), &fence, clock).await? == 0 {
            break;
        }
        let rows = db
            .prepare(
                "SELECT id FROM lt_mail_jobs WHERE fence=?1 AND state='sent' AND transport='fake'",
            )
            .bind(&[fence.into()])?
            .all()
            .await?
            .results::<Value>()?;
        delivered += rows.len() as u32;
    }
    Ok(delivered)
}
