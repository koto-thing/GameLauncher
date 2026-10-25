use serde_json::{Value, json};
use worker::*;

/// 公開許可項目を取り出す
/// 引数: 保存済み公開版、登壇内容フラグ
/// 戻り値: 私有項目を除去した公開 DTO
fn public_dto(v: &Value, talk: bool) -> Value {
    let keys: &[&str] = if talk {
        &[
            "id",
            "eventId",
            "version",
            "title",
            "abstract",
            "description",
            "startsAt",
            "endsAt",
            "cancelled",
        ]
    } else {
        &[
            "id",
            "version",
            "title",
            "venue",
            "guidance",
            "startsAt",
            "endsAt",
            "timeZone",
            "recruitment",
        ]
    };
    let mut dto = json!({});
    // 私有申請項目は保存内容に混在していても返さない
    for k in keys {
        if let Some(x) = v.get(*k) {
            dto[*k] = x.clone();
        }
    }
    let (field, allowed): (&str, &[&str]) = if talk {
        ("speakers", &["displayName", "affiliation", "profile"])
    } else {
        ("schedule", &["id", "kind", "talkId", "startsAt", "endsAt"])
    };
    dto[field] = Value::Array(
        v[field]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| {
                        let mut out = json!({});
                        for k in allowed {
                            if let Some(y) = x.get(*k) {
                                out[*k] = y.clone();
                            }
                        }
                        out
                    })
                    .collect()
            })
            .unwrap_or_default(),
    );
    dto
}

/// 公開 HTTP と D1 読み取りを Rust で処理する
/// 引数: HTTP リクエスト、環境、コンテキスト
/// 戻り値: 公開 DTO または拒否応答
#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    let p: Vec<_> = path.trim_matches('/').split('/').collect();
    // 運営ルートは公開入口に登録しない
    let mut response = if req.method() == Method::Get
        && p.starts_with(&["api", "lt", "v1", "events"])
    {
        let talk = p.len() == 7 && p[5] == "talks";
        if p.len() != 4 && p.len() != 5 && !talk {
            Response::error("Not found", 404)?
        } else {
            let db = env.d1("DB")?;
            let sql = if talk {
                "SELECT p.dto FROM lt_public_talks p JOIN lt_events e ON e.id=p.event_id WHERE e.state IN ('scheduled','started','ended') AND e.id=?1 AND p.id=?2"
            } else if p.len() == 5 {
                "SELECT p.dto FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE e.state IN ('scheduled','started','ended') AND e.id=?1"
            } else {
                "SELECT p.dto FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE e.state IN ('scheduled','started','ended') ORDER BY e.id"
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
                let saved: Value = serde_json::from_str(
                    row["dto"]
                        .as_str()
                        .ok_or_else(|| Error::RustError("Invalid snapshot".into()))?,
                )?;
                items.push(public_dto(&saved, talk));
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_fields_are_removed_recursively() {
        let dto = public_dto(
            &json!({"representativeEmail":"private","schedule":[{"id":"s","operatorNote":"private"}]}),
            false,
        );
        assert!(dto.get("representativeEmail").is_none());
        assert!(dto["schedule"][0].get("operatorNote").is_none());
    }
}
