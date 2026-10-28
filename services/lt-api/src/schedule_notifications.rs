use serde_json::{Value, json};
use worker::*;

pub struct Snapshot {
    event_id: String,
    starts_at: String,
    talks: Value,
}

impl Snapshot {
    /// 確定操作前の開催日時と申請ごとの公開時刻を取得する
    ///
    /// # 引数
    /// - `db`: 公開時刻を保存するデータベース
    /// - `event_id`: 対象開催回
    ///
    /// # 戻り値
    /// 変更通知の対象判定に使う保存前の時刻
    ///
    /// # エラー
    /// DB読取または保存JSONの解析に失敗した場合
    pub async fn load(db: &D1Database, event_id: &str) -> Result<Self> {
        let event = db.prepare("SELECT json_extract(dto,'$.startsAt') AS start FROM lt_public_events WHERE event_id=?1").bind(&[event_id.into()])?.first::<Value>(None).await?;
        let talks = db.prepare("SELECT id,json_extract(dto,'$.published.startsAt') AS start,json_extract(dto,'$.published.endsAt') AS end FROM lt_applications WHERE event_id=?1").bind(&[event_id.into()])?.all().await?.results::<Value>()?;
        Ok(Self {
            event_id: event_id.into(),
            starts_at: event
                .and_then(|value| value["start"].as_str().map(str::to_owned))
                .unwrap_or_default(),
            talks: json!(talks),
        })
    }

    /// 成功した一括確定に限り変更対象者へ一件ずつ通知を予約する
    ///
    /// # 引数
    /// - `db`: 通知を保存するデータベース
    /// - `actor`: 操作を確定した運営者
    /// - `operation`: 一括確定の識別子
    /// - `schedule`: 時間割の確定ならtrue、開催設定ならfalse
    ///
    /// # 戻り値
    /// 設定更新と同じ原子処理で実行する通知挿入文
    ///
    /// # エラー
    /// SQLパラメーターの設定に失敗した場合
    pub fn statement(
        &self,
        db: &D1Database,
        actor: &str,
        operation: &str,
        schedule: bool,
    ) -> Result<D1PreparedStatement> {
        let receipt = if schedule {
            "lt_schedule_operations"
        } else {
            "lt_event_operations"
        };
        db.prepare(format!("INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT ?1||':schedule:'||a.id,?1,a.id,'scheduleChanged',a.email,e.private_expires FROM lt_applications a JOIN lt_events e ON e.id=a.event_id JOIN lt_public_events p ON p.event_id=e.id JOIN json_each(?2) old ON json_extract(old.value,'$.id')=a.id WHERE a.event_id=?3 AND a.email!='' AND a.active=1 AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn') AND json_extract(a.dto,'$.withdrawal')='none' AND (json_extract(p.dto,'$.startsAt')!=?4 OR (json_extract(a.dto,'$.slotReserved')=1 AND (json_extract(old.value,'$.start') IS NOT json_extract(a.dto,'$.published.startsAt') OR json_extract(old.value,'$.end') IS NOT json_extract(a.dto,'$.published.endsAt')))) AND EXISTS(SELECT 1 FROM {receipt} WHERE actor=?5 AND operation_id=?1 AND event_id=?3) ON CONFLICT DO NOTHING"))
            .bind(&[operation.into(),self.talks.to_string().into(),self.event_id.clone().into(),self.starts_at.clone().into(),actor.into()])
    }
}
