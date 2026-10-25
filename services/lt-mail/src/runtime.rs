//! APIのD1と内部schedulerから呼ぶ。公開ルートを持たない
use crate::{Outcome, State, classify, decide};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use worker::*;

/// 通常時計。固定値は検証featureだけで利用可能
#[derive(Clone, Copy)]
pub enum Clock {
    System,
    #[cfg(feature = "test-clock")]
    Fixed(i64),
}
impl Clock {
    /// 配送の各段階で現在秒を取得する
    /// 引数: 時計
    /// 戻り値: UTC epoch秒
    pub fn now(self) -> i64 {
        match self {
            Self::System => (Date::now().as_millis() / 1000) as i64,
            #[cfg(feature = "test-clock")]
            Self::Fixed(value) => value,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// 信頼済みAPIがoutboxから生成する送信内容
pub struct Envelope {
    pub id: String,
    pub recipient: String,
    pub kind: String,
    pub expires: i64,
    pub action_url: String,
}
/// 未設定時はDisabledを選ぶ排他的な送信設定
pub enum Transport {
    Disabled,
    Fake(Outcome),
    Http { endpoint: String, bearer: String },
}
/// outboxと宛先・種類・固定期限が一致したときだけ投入する
/// 引数: DB、信頼済みenvelope、配送時計
/// 戻り値: 新規保存数
pub async fn enqueue(db: &D1Database, e: &Envelope, clock: Clock) -> Result<u32> {
    if e.expires <= clock.now() || e.expires > clock.now() + 86400 {
        return Ok(0);
    }
    let r=db.prepare("INSERT INTO lt_mail_jobs(id,envelope,expires) SELECT id,?1,?2 FROM lt_mail_outbox WHERE id=?3 AND recipient=?4 AND kind=?5 AND state='pending' AND (expires IS NULL OR expires>=?2*1000) ON CONFLICT DO NOTHING").bind(&[serde_json::to_string(e)?.into(),(e.expires as f64).into(),e.id.clone().into(),e.recipient.clone().into(),e.kind.clone().into()])?.run().await?;
    Ok(r.meta()?.and_then(|m| m.changes).unwrap_or(0) as u32)
}
/// 一件を原子的claimし、fenceを検証して結果を保存する
/// 引数: DB、排他的transport、毎回異なるattempt ID
/// 戻り値: 処理件数
pub async fn dispatch_one(
    db: &D1Database,
    t: &Transport,
    fence: &str,
    clock: Clock,
) -> Result<u32> {
    let mode = match t {
        Transport::Disabled => return Ok(0),
        Transport::Fake(_) => "fake",
        Transport::Http { .. } => "http",
    };
    if fence.is_empty() {
        return Ok(0);
    }
    let now = clock.now();
    // lease切れは結果不明として隔離し、自動再送しない
    db.prepare("UPDATE lt_mail_jobs SET state=CASE WHEN expires<=?1 THEN 'expired' ELSE 'uncertain' END WHERE state='leased' AND lease_until<=?1").bind(&[(now as f64).into()])?.run().await?;
    db.prepare("UPDATE lt_mail_jobs SET state='expired',envelope='{}' WHERE expires<=?1 AND state!='leased'").bind(&[(now as f64).into()])?.run().await?;
    let rows=db.prepare("UPDATE lt_mail_jobs SET state='leased',transport=?3,attempts=attempts+1,fence=?1,lease_until=?2+120 WHERE id=(SELECT j.id FROM lt_mail_jobs j JOIN lt_mail_outbox o ON o.id=j.id WHERE j.state='pending' AND j.next_at<=?2 AND j.expires>?2 AND o.state='pending' AND (o.expires IS NULL OR o.expires>?2*1000) AND EXISTS(SELECT 1 FROM lt_mail_mode WHERE id=1 AND mode=?3) ORDER BY CASE WHEN o.kind='emailConfirmation' THEN 0 ELSE 1 END,j.next_at,j.id LIMIT 1) AND state='pending' RETURNING envelope,expires,attempts").bind(&[fence.into(),(now as f64).into(),mode.into()])?.all().await?.results::<Value>()?;
    let Some(row) = rows.first() else {
        return Ok(0);
    };
    let mut e: Envelope = serde_json::from_str(row["envelope"].as_str().unwrap())?;
    // claim後に短縮された保持期限を送信直前にもう一度反映する
    let latest=db.prepare("SELECT MIN(j.expires,CAST(COALESCE(o.expires,j.expires*1000)/1000 AS INTEGER)) AS expires,j.lease_until AS lease_until FROM lt_mail_jobs j JOIN lt_mail_outbox o ON o.id=j.id WHERE j.id=?1 AND j.fence=?2 AND j.state='leased' AND o.state='pending' AND EXISTS(SELECT 1 FROM lt_mail_mode WHERE id=1 AND mode=?3)").bind(&[e.id.clone().into(),fence.into(),mode.into()])?.all().await?.results::<Value>()?;
    let Some(current) = latest.first() else {
        return Ok(0);
    };
    e.expires = e.expires.min(current["expires"].as_i64().unwrap());
    // claim時のnowを使い回さず、DB再照会後の送信直前時刻で判定する
    let send_now = clock.now();
    if e.expires <= send_now {
        db.prepare("UPDATE lt_mail_jobs SET state='expired',envelope='{}',lease_until=NULL WHERE id=?1 AND fence=?2 AND state='leased'").bind(&[e.id.clone().into(),fence.into()])?.run().await?;
        return Ok(0);
    }
    // 同じworkerが遅延しても期限切れleaseで送信しない
    if current["lease_until"]
        .as_i64()
        .is_none_or(|until| until <= send_now)
    {
        db.prepare("UPDATE lt_mail_jobs SET state='uncertain',lease_until=NULL WHERE id=?1 AND fence=?2 AND state='leased' AND (lease_until IS NULL OR lease_until<=?3)").bind(&[e.id.clone().into(),fence.into(),(send_now as f64).into()])?.run().await?;
        return Ok(0);
    }
    let outcome = match t {
        Transport::Fake(v) => *v,
        Transport::Http { endpoint, bearer } => send(endpoint, bearer, &e).await,
        Transport::Disabled => return Ok(0),
    };
    let d = decide(
        outcome,
        clock.now(),
        e.expires,
        row["attempts"].as_u64().unwrap() as u32,
    );
    let state = match d.state {
        State::Pending => "pending",
        State::Sent => "sent",
        State::Failed => "failed",
        State::Uncertain => "uncertain",
        State::Expired => "expired",
    };
    db.batch(vec![db.prepare("UPDATE lt_mail_jobs SET state=?1,next_at=?2,lease_until=NULL,delivered_at=CASE WHEN ?1='sent' THEN ?5 ELSE delivered_at END WHERE id=?3 AND fence=?4 AND state='leased'").bind(&[state.into(),(d.next_at.unwrap_or(0) as f64).into(),e.id.clone().into(),fence.into(),(clock.now() as f64).into()])?,db.prepare("UPDATE lt_outbox SET state='sent' WHERE 'application:'||id=?1 AND EXISTS(SELECT 1 FROM lt_mail_jobs j WHERE j.id=?1 AND j.fence=?2 AND j.state='sent')").bind(&[e.id.clone().into(),fence.into()])?,db.prepare("UPDATE lt_login_outbox SET state='sent' WHERE 'authentication:'||id=?1 AND EXISTS(SELECT 1 FROM lt_mail_jobs j WHERE j.id=?1 AND j.fence=?2 AND j.state='sent')").bind(&[e.id.into(),fence.into()])?]).await?;
    Ok(1)
}
/// HTTPS中継だけへ送る。秘密をログに出さない
/// 引数: 設定済みURL、認証値、envelope
/// 戻り値: 固定結果分類
async fn send(endpoint: &str, bearer: &str, e: &Envelope) -> Outcome {
    let Ok(url) = Url::parse(endpoint) else {
        return Outcome::Permanent;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || bearer.len() < 32
    {
        return Outcome::Permanent;
    }
    let result = async {
        let headers = Headers::new();
        headers.set("Content-Type", "application/json")?;
        headers.set("Authorization", &format!("Bearer {bearer}"))?;
        let mut init = RequestInit::new();
        init.with_method(Method::Post)
            .with_headers(headers)
            .with_redirect(RequestRedirect::Error)
            .with_body(Some(serde_json::to_string(e)?.into()));
        let mut r = Fetch::Request(Request::new_with_init(endpoint, &init)?)
            .send()
            .await?;
        let status = r.status_code();
        let v: Value = r.json().await?;
        Ok::<Outcome, worker::Error>(classify(status, v["result"].as_str().unwrap_or("")))
    };
    result.await.unwrap_or(Outcome::Uncertain)
}
