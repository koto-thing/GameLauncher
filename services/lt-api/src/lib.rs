use serde_json::{Value, json};
use worker::*;
mod applicant;
mod applicant_dto;
mod events;
mod operator;
mod timetable;
pub use operator::{fake_dispatch, operator_request};

mod public_dto;

/// 公開 HTTP と D1 読み取りを Rust で処理する
/// 引数: HTTP リクエスト、環境、コンテキスト
/// 戻り値: 公開 DTO または拒否応答
#[event(fetch)]
pub async fn main(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    let p: Vec<_> = path.trim_matches('/').split('/').collect();
    // 運営ルートは公開入口に登録しない
    let private = match applicant::handle(&mut req, &env).await {
        Ok(value) => value,
        Err(error) if error.to_string().contains("LT_OPERATION_CONFLICT") => Some(
            Response::from_json(
                &json!({"error":{"code":"VERSION_CONFLICT","requestId":"applicant"}}),
            )?
            .with_status(409),
        ),
        Err(error) => return Err(error),
    };
    let mut response = if let Some(response) = private {
        response
    } else if req.method() == Method::Get && p.starts_with(&["api", "lt", "v1", "events"]) {
        let talk = p.len() == 7 && p[5] == "talks";
        if p.len() != 4 && p.len() != 5 && !talk {
            Response::error("Not found", 404)?
        } else {
            let db = env.d1("DB")?;
            let sql = if talk {
                "SELECT p.dto FROM lt_public_talks p JOIN lt_events e ON e.id=p.event_id WHERE p.approval_operation IS NOT NULL AND e.state IN ('scheduled','started','ended') AND e.public_opens_at <= CAST(unixepoch('subsec')*1000 AS INTEGER) AND e.id=?1 AND p.id=?2"
            } else if p.len() == 5 {
                "SELECT p.dto,e.state,(SELECT closes FROM lt_recruitment WHERE event_id=e.id) AS closes,(SELECT capacity FROM lt_recruitment WHERE event_id=e.id) AS capacity,(SELECT reserved FROM lt_recruitment WHERE event_id=e.id) AS reserved FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE NOT EXISTS(SELECT 1 FROM json_each(p.dto,'$.schedule') b WHERE json_extract(b.value,'$.kind')='talk' AND NOT EXISTS(SELECT 1 FROM lt_public_talks t WHERE t.id=json_extract(b.value,'$.talkId') AND t.event_id=e.id AND t.approval_operation IS NOT NULL)) AND e.state IN ('scheduled','started','ended') AND e.public_opens_at <= CAST(unixepoch('subsec')*1000 AS INTEGER) AND e.id=?1"
            } else {
                "SELECT p.dto,e.state,(SELECT closes FROM lt_recruitment WHERE event_id=e.id) AS closes,(SELECT capacity FROM lt_recruitment WHERE event_id=e.id) AS capacity,(SELECT reserved FROM lt_recruitment WHERE event_id=e.id) AS reserved FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE NOT EXISTS(SELECT 1 FROM json_each(p.dto,'$.schedule') b WHERE json_extract(b.value,'$.kind')='talk' AND NOT EXISTS(SELECT 1 FROM lt_public_talks t WHERE t.id=json_extract(b.value,'$.talkId') AND t.event_id=e.id AND t.approval_operation IS NOT NULL)) AND e.state IN ('scheduled','started','ended') AND e.public_opens_at <= CAST(unixepoch('subsec')*1000 AS INTEGER) ORDER BY e.id"
            };
            let mut stmt = db.prepare(sql);
            if talk {
                stmt = stmt.bind(&[p[4].into(), p[6].into()])?;
            } else if p.len() == 5 {
                stmt = stmt.bind(&[p[4].into()])?;
            }
            let rows = stmt.all().await?.results::<Value>()?;
            let mut items = Vec::new();
            for row in rows {
                let mut saved: Value = serde_json::from_str(
                    row["dto"]
                        .as_str()
                        .ok_or_else(|| Error::RustError("Invalid snapshot".into()))?,
                )?;
                if !talk && row["closes"].is_number() {
                    saved["recruitment"] = json!(if row["state"] != "scheduled"
                        || row["closes"].as_f64().unwrap() <= Date::now().as_millis() as f64
                    {
                        "closed"
                    } else if row["reserved"].as_i64() >= row["capacity"].as_i64() {
                        "full"
                    } else {
                        "open"
                    });
                }
                if let Some(dto) = public_dto::validate(&saved, talk) {
                    items.push(dto);
                }
            }
            if p.len() == 4 {
                Response::from_json(&json!({"items":items,"nextCursor":null}))?
            } else if let Some(dto) = items.first() {
                Response::from_json(dto)?
            } else {
                Response::from_json(
                    &json!({"error":{"code":"NOT_FOUND","requestId":"public-read"}}),
                )?
                .with_status(404)
            }
        }
    } else if path.starts_with("/api/lt/v1/operator/") {
        Response::error("Not found", 404)?
    } else {
        Response::error("Not implemented", 501)?
    };
    // 全体中止をキャッシュで遅らせない
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("Referrer-Policy", "no-referrer")?;
    Ok(response)
}
