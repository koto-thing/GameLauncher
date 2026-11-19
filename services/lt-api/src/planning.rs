use serde::{Deserialize, Serialize};
use worker::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Planning {
    pub relative_recruitment: bool,
    pub opens_days_before: u32,
    pub closes_days_before: u32,
    pub material_days_before: u32,
    pub reminder_days_before: u32,
}

impl Planning {
    /// 相対締切の範囲と前後関係を検証する
    ///
    /// # 戻り値
    /// 募集開始が終了より前で、各日数が365日以内ならtrue
    pub fn valid(&self) -> bool {
        self.opens_days_before > self.closes_days_before
            && self.opens_days_before <= 365
            && self.material_days_before <= 365
            && self.reminder_days_before <= 365
    }
}

/// 開始日時から指定した24時間単位の日数を引く
///
/// # 引数
/// - `start`: 開催開始のRFC3339日時
/// - `days`: 開催開始から遡る日数
///
/// # 戻り値
/// UTCミリ秒精度の日時、入力不正や範囲外ならNone
pub fn before(start: &str, days: u32) -> Option<String> {
    // UTC に統一してから一日を24時間として差し引く
    let start =
        time::OffsetDateTime::parse(start, &time::format_description::well_known::Rfc3339).ok()?;
    let deadline = start
        .checked_to_offset(time::UtcOffset::UTC)?
        .checked_sub(time::Duration::days(days.into()))?;
    deadline
        .format(time::macros::format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
        ))
        .ok()
}

/// 資料の提出・確認が残る対象へ期限前の通知を一度だけ予約する
///
/// # 引数
/// - `db`: 開催設定と通知を保存するデータベース
/// - `now`: 現在のUTCミリ秒
///
/// # 戻り値
/// 状態更新と同じ原子処理で実行するSQL文
///
/// # エラー
/// SQLパラメーターの設定に失敗した場合
pub fn reminders(db: &D1Database, now: f64) -> Result<Vec<D1PreparedStatement>> {
    Ok(vec![
        // 確認済み、辞退、中止になった予約は配送前に期限切れにする
        db.prepare("UPDATE lt_outbox SET expires=?1 WHERE kind='materialReminder' AND state='pending' AND (expires IS NULL OR expires>?1) AND NOT EXISTS(SELECT 1 FROM lt_applications a JOIN lt_events e ON e.id=a.event_id JOIN lt_event_configs c ON c.id=e.id WHERE a.id=lt_outbox.application_id AND lt_outbox.operation_id='material:'||CAST(unixepoch(json_extract(c.dto,'$.startsAt'),'subsec')*1000-json_extract(c.dto,'$.planning.materialDaysBefore')*86400000 AS INTEGER) AND e.state='scheduled' AND a.active=1 AND json_extract(a.dto,'$.withdrawal')='none' AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn') AND (COALESCE(json_extract(a.dto,'$.materialUrl'),'')='' OR COALESCE(json_extract(a.dto,'$.materialReviewedUrl'),'')!=json_extract(a.dto,'$.materialUrl')))").bind(&[now.into()])?,
        // 期限を識別子に含め、定期実行やアクセスの重複で同じ案内を作らない
        db.prepare("INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT 'material:'||a.id||':'||CAST(r.deadline AS INTEGER),'material:'||CAST(r.deadline AS INTEGER),a.id,'materialReminder',a.email,r.deadline FROM lt_applications a JOIN lt_events e ON e.id=a.event_id JOIN (SELECT id,unixepoch(json_extract(dto,'$.startsAt'),'subsec')*1000-json_extract(dto,'$.planning.materialDaysBefore')*86400000 AS deadline,json_extract(dto,'$.planning.reminderDaysBefore')*86400000 AS notice FROM lt_event_configs WHERE json_type(dto,'$.planning')='object') r ON r.id=e.id WHERE e.state='scheduled' AND e.publish_enabled=1 AND (e.private_expires IS NULL OR e.private_expires>?1) AND a.email!='' AND a.active=1 AND json_extract(a.dto,'$.withdrawal')='none' AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn') AND (COALESCE(json_extract(a.dto,'$.materialUrl'),'')='' OR COALESCE(json_extract(a.dto,'$.materialReviewedUrl'),'')!=json_extract(a.dto,'$.materialUrl')) AND ?1>=r.deadline-r.notice AND ?1<r.deadline ON CONFLICT DO NOTHING").bind(&[now.into()])?,
    ])
}

#[cfg(test)]
mod tests {
    use super::before;
    use crate::input::millis;

    /// オフセットを含む開催日から UTC 締切を生成し、ミリ秒契約で読み戻す
    ///
    /// # 戻り値
    /// 戻り値なし
    #[test]
    fn utc_deadline_round_trip() {
        let deadline = before("1970-01-02T08:59:59.999+09:00", 1).unwrap();
        assert_eq!(deadline, "1969-12-31T23:59:59.999Z");
        assert_eq!(millis(&deadline), Some(-1));

        // 日付境界を越えても小数部は必ず3桁とし、不正な暦日は拒否する
        assert_eq!(
            before("2024-03-01T00:00:00Z", 1).as_deref(),
            Some("2024-02-29T00:00:00.000Z")
        );
        assert_eq!(millis("2025-02-29T00:00:00.000Z"), None);
    }
}
