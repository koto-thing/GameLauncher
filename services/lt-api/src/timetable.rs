use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use worker::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    expected_version: u64,
    operation_id: String,
    data: Data,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Data {
    expected_event_version: u64,
    blocks: Vec<Block>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Block {
    id: String,
    kind: String,
    #[serde(default, deserialize_with = "optional_id")]
    talk_id: Option<String>,
    starts_at: String,
    ends_at: String,
    #[serde(default)]
    locked: bool,
}

/// UTCミリ秒表記を検証する
/// 引数: 時刻文字列
/// 戻り値: epochミリ秒
fn millis(s: &str) -> Option<i64> {
    if s.len() != 24 || !s.ends_with('Z') {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

/// 全発表と直後の入替を検証する
/// 引数: blocks、必須発表ID、開始日時、共通持ち時間、入替時間
/// 戻り値: 全時間割が妥当か
fn valid(
    blocks: &[Block],
    required: &BTreeSet<String>,
    start: &str,
    talk: i64,
    transition: i64,
) -> bool {
    let mut ids = BTreeSet::new();
    let mut talks = BTreeSet::new();
    let mut previous = millis(start);
    if blocks.is_empty() {
        return required.is_empty();
    }
    for (i, b) in blocks.iter().enumerate() {
        let (Some(s), Some(e)) = (millis(&b.starts_at), millis(&b.ends_at)) else {
            return false;
        };
        if b.id.is_empty()
            || !ids.insert(&b.id)
            || previous.is_none_or(|previous| s < previous)
            || e < s
            || (e == s && b.kind != "transition")
        {
            return false;
        }
        previous = Some(e);
        match b.kind.as_str() {
            "talk" => {
                let Some(id) = &b.talk_id else { return false };
                if !talks.insert(id.clone())
                    || e - s != talk * 60000
                    || blocks
                        .get(i + 1)
                        .is_none_or(|next| next.kind != "transition")
                {
                    return false;
                }
            }
            "transition" => {
                if b.locked
                    || i == 0
                    || millis(&blocks[i - 1].ends_at) != Some(s)
                    || blocks[i - 1].kind != "talk"
                    || e - s != transition * 60000
                    || b.talk_id.is_some()
                {
                    return false;
                }
            }
            "opening" | "break" | "closing" => {
                if b.kind == "opening" && i != 0 || b.kind == "closing" && i + 1 != blocks.len() {
                    return false;
                }
                if b.talk_id.is_some() {
                    return false;
                }
            }
            _ => return false,
        }
    }
    &talks == required
}

/// 発表順を保存し、自動方式の補助枠と応答を再生成する
///
/// # 引数
/// - `req`: 保存する時間割と期待版を含むリクエスト
/// - `db`: 時間割と開催設定を保存するデータベース
/// - `event`: 対象の開催回ID
/// - `actor`: 操作を行う運営者のID
/// - `request_id`: エラー応答の追跡用ID
///
/// # 戻り値
/// 保存済み時間割または契約エラーのHTTP応答
///
/// # エラー
/// データベース処理に失敗した場合
pub async fn save(
    req: &mut Request,
    db: &D1Database,
    event: &str,
    actor: &str,
    request_id: &str,
) -> Result<Response> {
    let now = crate::lifecycle::now(db).await?;
    let error = |code: &str, status: u16| -> Result<Response> {
        Ok(
            Response::from_json(&json!({"error":{"code":code,"requestId":request_id}}))?
                .with_status(status),
        )
    };
    let raw: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422),
    };
    let input: Input = match serde_json::from_value(raw.clone()) {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422),
    };
    if input.expected_version == 0
        || input.data.expected_event_version == 0
        || input.operation_id.is_empty()
    {
        return error("VALIDATION", 422);
    }
    let hash = Sha256::digest(format!("{event}:{raw}").as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let replay=db.prepare("SELECT result,payload_hash FROM lt_schedule_operations WHERE EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_schedule_operations.event_id AND (e.private_expires IS NULL OR e.private_expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))) AND actor=?1 AND operation_id=?2 AND (expires IS NULL OR expires>CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER))").bind(&[actor.into(),input.operation_id.clone().into()])?.all().await?.results::<Value>()?;
    if let Some(r) = replay.first() {
        return if r["payload_hash"] == hash {
            Response::from_json(&serde_json::from_str::<Value>(
                r["result"].as_str().unwrap(),
            )?)
        } else {
            error("VERSION_CONFLICT", 409)
        };
    }
    let rows=db.prepare("SELECT p.dto,r.talk_minutes,r.transition_minutes,e.private_expires FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id JOIN lt_recruitment r ON r.event_id=e.id WHERE e.id=?1").bind(&[event.into()])?.all().await?.results::<Value>()?;
    let Some(row) = rows.first() else {
        return error("NOT_FOUND", 404);
    };
    if row["private_expires"].as_f64().is_some_and(|x| x <= now) {
        return error("RETENTION_EXPIRED", 410);
    }
    let public: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    let required=db.prepare("SELECT a.id FROM lt_applications a WHERE a.event_id=?1 AND (json_extract(a.dto,'$.slotReserved')=1 OR (json_extract(a.dto,'$.withdrawal')='confirmed' AND EXISTS(SELECT 1 FROM lt_schedule s,json_each(s.blocks) b WHERE s.event_id=a.event_id AND json_extract(b.value,'$.talkId')=a.id)))").bind(&[event.into()])?.all().await?.results::<Value>()?.iter().filter_map(|r|r["id"].as_str().map(str::to_owned)).collect::<BTreeSet<_>>();
    if !valid(
        &input.data.blocks,
        &required,
        public["startsAt"].as_str().unwrap(),
        row["talk_minutes"].as_i64().unwrap(),
        row["transition_minutes"].as_i64().unwrap(),
    ) {
        return error("VALIDATION", 422);
    }
    // 開始後に予定を残した中止発表は、その予定時刻を後続保存でも維持する
    let cancelled=db.prepare("SELECT id,dto FROM lt_applications WHERE event_id=?1 AND json_extract(dto,'$.withdrawal')='confirmed'").bind(&[event.into()])?.all().await?.results::<Value>()?;
    for row in cancelled {
        if let Some(block) = input
            .data
            .blocks
            .iter()
            .find(|b| b.talk_id.as_deref() == row["id"].as_str())
        {
            let old: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
            if old["published"]["startsAt"] != block.starts_at
                || old["published"]["endsAt"] != block.ends_at
            {
                return error("VALIDATION", 422);
            }
        }
    }
    // 保存版のversionと親event版を同じUPDATEで照合する
    let before = crate::schedule_notifications::Snapshot::load(db, event).await?;
    let saved=db.prepare("UPDATE lt_schedule SET blocks=?1,version=version+1,operation_id=?2,actor_id=?3,payload_hash=?4 WHERE event_id=?5 AND version=?6 AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_schedule.event_id AND e.version=?7 AND e.state!='cancelled' AND (e.private_expires IS NULL OR e.private_expires>CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)))").bind(&[raw["data"]["blocks"].to_string().into(),input.operation_id.clone().into(),actor.into(),hash.clone().into(),event.into(),(input.expected_version as f64).into(),(input.data.expected_event_version as f64).into()])?;
    // 自動方式では編集後の発表順を採用し、補助枠を開催ルールへ揃える
    let generated = db.prepare("UPDATE lt_schedule SET blocks=(SELECT g.blocks FROM lt_generated_schedule g WHERE g.event_id=?1),version=version+1,operation_id=?2 WHERE event_id=?1 AND version=?3 AND operation_id=?4 AND actor_id=?5 AND payload_hash=?6 AND (SELECT schedule_mode FROM lt_recruitment WHERE event_id=?1)='automatic'")
        .bind(&[event.into(), format!("{}:generated",input.operation_id).into(), ((input.expected_version+1) as f64).into(), input.operation_id.clone().into(), actor.into(), hash.clone().into()])?;
    let receipt = db.prepare("UPDATE lt_schedule_operations SET result=(SELECT json_object('eventId',s.event_id,'version',s.version,'eventVersion',e.version,'blocks',json(s.blocks)) FROM lt_schedule s JOIN lt_events e ON e.id=s.event_id WHERE s.event_id=?1) WHERE actor=?2 AND operation_id=?3 AND EXISTS(SELECT 1 FROM lt_schedule s WHERE s.event_id=?1 AND s.operation_id=?4 AND s.version=?5 AND s.payload_hash=?6)")
        .bind(&[event.into(),actor.into(),input.operation_id.clone().into(),format!("{}:generated",input.operation_id).into(),((input.expected_version+2) as f64).into(),hash.clone().into()])?;
    let changed = db
        .batch(vec![
            saved,
            generated,
            receipt,
            before.statement(db, actor, &input.operation_id, true)?,
        ])
        .await?;
    if changed[0].meta()?.unwrap().changes.unwrap_or(0) == 0 {
        if let Some(response) = crate::receipts::response(
            db,
            "schedule",
            actor,
            &input.operation_id,
            &hash,
            request_id,
        )
        .await?
        {
            return Ok(response);
        }
        return error("VERSION_CONFLICT", 409);
    }
    crate::receipts::response(
        db,
        "schedule",
        actor,
        &input.operation_id,
        &hash,
        request_id,
    )
    .await?
    .ok_or_else(|| Error::RustError("Missing timetable receipt".into()))
}

/// 省略可能IDの明示nullを拒否する
/// 引数: デシリアライザー
/// 戻り値: 有効文字列
fn optional_id<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
