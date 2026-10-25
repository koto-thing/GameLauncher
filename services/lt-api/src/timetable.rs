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
            || Some(s) != previous
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
                if i == 0
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

/// 条件付き時間割保存を実行する
/// 引数: request、DB、開催ID、actor、requestId
/// 戻り値: 運営時間割DTOまたは契約エラー
pub async fn save(
    req: &mut Request,
    db: &D1Database,
    event: &str,
    actor: &str,
    request_id: &str,
) -> Result<Response> {
    let error = |code: &str, status: u16| -> Result<Response> {
        Ok(
            Response::from_json(&json!({"error":{"code":code,"requestId":request_id}}))?
                .with_status(status),
        )
    };
    let raw: Value = match req.json().await {
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
    let replay=db.prepare("SELECT result,payload_hash FROM lt_schedule_operations WHERE EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_schedule_operations.event_id AND (e.private_expires IS NULL OR e.private_expires>unixepoch('subsec')*1000)) AND actor=?1 AND operation_id=?2 AND (expires IS NULL OR expires>CAST(unixepoch('subsec')*1000 AS INTEGER))").bind(&[actor.into(),input.operation_id.clone().into()])?.all().await?.results::<Value>()?;
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
    if row["private_expires"]
        .as_f64()
        .is_some_and(|x| x <= Date::now().as_millis() as f64)
    {
        return error("RETENTION_EXPIRED", 410);
    }
    let public: Value = serde_json::from_str(row["dto"].as_str().unwrap())?;
    let required=db.prepare("SELECT id FROM lt_applications WHERE event_id=?1 AND json_extract(dto,'$.slotReserved')=1").bind(&[event.into()])?.all().await?.results::<Value>()?.iter().filter_map(|r|r["id"].as_str().map(str::to_owned)).collect::<BTreeSet<_>>();
    if !valid(
        &input.data.blocks,
        &required,
        public["startsAt"].as_str().unwrap(),
        row["talk_minutes"].as_i64().unwrap(),
        row["transition_minutes"].as_i64().unwrap(),
    ) {
        return error("VALIDATION", 422);
    }
    // 保存版のversionと親event版を同じUPDATEで照合する
    let changed=db.prepare("UPDATE lt_schedule SET blocks=?1,version=version+1,operation_id=?2,actor_id=?3,payload_hash=?4 WHERE event_id=?5 AND version=?6 AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_schedule.event_id AND e.version=?7 AND e.state!='cancelled' AND (e.private_expires IS NULL OR e.private_expires>CAST(unixepoch('subsec')*1000 AS INTEGER)))").bind(&[raw["data"]["blocks"].to_string().into(),input.operation_id.into(),actor.into(),hash.into(),event.into(),(input.expected_version as f64).into(),(input.data.expected_event_version as f64).into()])?.run().await?;
    if changed.meta()?.unwrap().changes.unwrap_or(0) == 0 {
        return error("VERSION_CONFLICT", 409);
    }
    Response::from_json(
        &json!({"eventId":event,"version":input.expected_version+1,"eventVersion":input.data.expected_event_version,"blocks":raw["data"]["blocks"]}),
    )
}

/// 省略可能IDの明示nullを拒否する
/// 引数: デシリアライザー
/// 戻り値: 有効文字列
fn optional_id<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
