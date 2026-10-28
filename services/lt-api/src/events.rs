use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worker::wasm_bindgen::JsValue;
use worker::*;

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Settings {
    title: String,
    venue: String,
    guidance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    poster_url: Option<String>,
    starts_at: String,
    time_zone: String,
    opens_at: String,
    closes_at: String,
    capacity: u32,
    talk_minutes: u32,
    transition_minutes: u32,
    approval_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    planning: Option<crate::planning::Planning>,
}

/// ポスターを認証情報のないHTTPS画像URLに限定する
pub(crate) fn valid_poster_url(value: &str) -> bool {
    value.len() <= 2048
        && worker::Url::parse(value).is_ok_and(|u| {
            u.scheme() == "https"
                && u.host_str().is_some()
                && u.username().is_empty()
                && u.password().is_none()
        })
}

/// 入力日時をUTC epochへ変換する
/// 引数: 契約時刻
/// 戻り値: ミリ秒またはNone
fn time(s: &str) -> Option<i64> {
    if s.len() != 24 || !s.ends_with('Z') {
        None
    } else {
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.timestamp_millis())
    }
}

/// IANA timezoneをホストIntlで検証する
/// 引数: timezone
/// 戻り値: 有効か
fn zone(name: &str) -> bool {
    let run = || -> std::result::Result<(), JsValue> {
        let intl = js_sys::Reflect::get(&js_sys::global(), &"Intl".into())?;
        let ctor = js_sys::Reflect::get(&intl, &"DateTimeFormat".into())?;
        let options = js_sys::Object::new();
        js_sys::Reflect::set(&options, &"timeZone".into(), &name.into())?;
        let args = js_sys::Array::new();
        args.push(&"ja".into());
        args.push(&options);
        js_sys::Reflect::construct(&ctor.into(), &args)?;
        Ok(())
    };
    run().is_ok()
}

/// 設定の期間・共通時間・承認方式を検証する
///
/// # 引数
/// - `s`: 作成または更新する開催設定
///
/// # 戻り値
/// 全設定が有効ならtrue
fn valid(s: &Settings) -> bool {
    let (Some(open), Some(close), Some(start)) =
        (time(&s.opens_at), time(&s.closes_at), time(&s.starts_at))
    else {
        return false;
    };
    !s.title.trim().is_empty()
        && !s.venue.trim().is_empty()
        && s.poster_url
            .as_ref()
            .is_none_or(|url| valid_poster_url(url))
        && ["automatic", "manual"].contains(&s.approval_mode.as_str())
        && s.planning
            .as_ref()
            .is_none_or(crate::planning::Planning::valid)
        && s.capacity > 0
        && s.talk_minutes > 0
        && s.capacity <= 10000
        && s.talk_minutes <= 1440
        && s.transition_minutes <= 1440
        && open < close
        && close <= start
        && zone(&s.time_zone)
}

/// 開催回の現在の設定を取得する
///
/// # 引数
/// - `db`: 開催設定を保存するデータベース
/// - `id`: 取得する開催回のID
///
/// # 戻り値
/// 有効な開催設定、存在しないか保持期限後ならNone
///
/// # エラー
/// データベースの読取に失敗した場合
pub async fn detail(db: &D1Database, id: &str) -> Result<Option<Value>> {
    let now = crate::lifecycle::now(db).await?;
    let rows=db.prepare("SELECT p.dto,(SELECT dto FROM lt_event_configs WHERE id=e.id) AS config,e.version,e.state,e.publish_enabled,e.private_expires,r.opens,r.closes,r.capacity,r.talk_minutes,r.transition_minutes,r.approval_mode FROM lt_events e JOIN lt_public_events p ON p.event_id=e.id JOIN lt_recruitment r ON r.event_id=e.id WHERE e.id=?1").bind(&[id.into()])?.all().await?.results::<Value>()?;
    let Some(r) = rows.first() else {
        return Ok(None);
    };
    if r["private_expires"].as_f64().is_some_and(|x| x <= now) {
        return Ok(None);
    }
    let p: Value = serde_json::from_str(r["dto"].as_str().unwrap())?;
    let instant = |value: &Value| {
        js_sys::Date::new(&value.as_f64().unwrap().into())
            .to_iso_string()
            .as_string()
            .unwrap()
    };
    let mut result = json!({"id":id,"version":r["version"],"state":r["state"],"publishEnabled":r["publish_enabled"]==1,"title":p["title"],"venue":p["venue"],"guidance":p["guidance"],"startsAt":p["startsAt"],"timeZone":p["timeZone"],"opensAt":instant(&r["opens"]),"closesAt":instant(&r["closes"]),"capacity":r["capacity"],"talkMinutes":r["talk_minutes"],"transitionMinutes":r["transition_minutes"],"approvalMode":r["approval_mode"]});
    if let Some(url) = p.get("posterUrl") {
        result["posterUrl"] = url.clone();
    }
    if let Some(config) = r["config"].as_str() {
        let config: Value = serde_json::from_str(config)?;
        if let Some(planning) = config.get("planning") {
            result["planning"] = planning.clone();
        }
    }
    Ok(Some(result))
}

/// 開催設定の一覧・作成・更新・コピーを扱う
///
/// # 引数
/// - `req`: 認証済み運営リクエスト
/// - `db`: 開催設定を保存するデータベース
/// - `actor`: 操作を行う運営者のID
/// - `request_id`: エラー応答の追跡用ID
///
/// # 戻り値
/// 対象ルートのHTTP応答、対象外ならNone
///
/// # エラー
/// データベース処理に失敗した場合
pub async fn handle(
    req: &mut Request,
    db: &D1Database,
    actor: &str,
    request_id: &str,
) -> Result<Option<Response>> {
    let now = crate::lifecycle::now(db).await?;
    let path = req.path();
    let p: Vec<_> = path.trim_matches('/').split('/').collect();
    if p.len() < 5 || p[4] != "events" || p.len() > 7 {
        return Ok(None);
    }
    let create = req.method() == Method::Post && p.len() == 5;
    let copy = req.method() == Method::Post && p.len() == 7 && p[6] == "copy";
    let update = req.method() == Method::Patch && p.len() == 6;
    let error = |code: &str, status: u16| -> Result<Option<Response>> {
        Ok(Some(
            Response::from_json(&json!({"error":{"code":code,"requestId":request_id}}))?
                .with_status(status),
        ))
    };
    if req.method() == Method::Get && p.len() == 5 {
        let rows = db
            .prepare("SELECT id FROM lt_events ORDER BY id")
            .all()
            .await?
            .results::<Value>()?;
        let mut items = Vec::new();
        for row in rows {
            if let Some(dto) = detail(db, row["id"].as_str().unwrap()).await? {
                items.push(dto)
            }
        }
        return Ok(Some(Response::from_json(
            &json!({"items":items,"nextCursor":null}),
        )?));
    }
    if req.method() == Method::Get && p.len() == 6 {
        return match detail(db, p[5]).await? {
            Some(v) => Ok(Some(Response::from_json(&v)?)),
            None => error("NOT_FOUND", 404),
        };
    }
    if !create && !copy && !update {
        return Ok(None);
    }
    let mut raw: Value = match crate::input::json(req).await {
        Ok(v) => v,
        Err(_) => return error("VALIDATION", 422),
    };
    let Some(op) = raw["operationId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
    else {
        return error("VALIDATION", 422);
    };
    let hash = Sha256::digest(format!("{}:{path}:{raw}", req.method()).as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let prior=db.prepare("SELECT result,payload_hash FROM lt_event_operations WHERE EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_event_operations.event_id AND (e.private_expires IS NULL OR e.private_expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))) AND actor=?1 AND operation_id=?2 AND (expires IS NULL OR expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))").bind(&[actor.into(),op.clone().into()])?.all().await?.results::<Value>()?;
    if let Some(r) = prior.first() {
        return if r["payload_hash"] == hash {
            Ok(Some(Response::from_json(
                &crate::views::event(
                    db,
                    &serde_json::from_str::<Value>(r["result"].as_str().unwrap())?,
                )
                .await?,
            )?))
        } else {
            error("VERSION_CONFLICT", 409)
        };
    }
    let expected = if create {
        0
    } else {
        match raw["expectedVersion"].as_u64().filter(|x| *x > 0) {
            Some(v) => v,
            None => return error("VALIDATION", 422),
        }
    };
    let mut settings: Settings = if copy {
        if !raw.as_object().is_some_and(|o| {
            o.len() == 3
                && o.contains_key("expectedVersion")
                && o.contains_key("operationId")
                && o.contains_key("data")
        }) || raw["data"] != json!({})
        {
            return error("VALIDATION", 422);
        }
        let Some(old) = detail(db, p[5]).await? else {
            return error("NOT_FOUND", 404);
        };
        if old["version"] != expected {
            return error("VERSION_CONFLICT", 409);
        }
        // 会場・枠数・共通時間・承認方式を引き継ぎ、日付は新しい開催回用に作る
        let start = now + 30.0 * 86400000.0;
        let instant = |t: f64| {
            js_sys::Date::new(&t.into())
                .to_iso_string()
                .as_string()
                .unwrap()
        };
        Settings {
            title: "LT会".into(),
            guidance: String::new(),
            poster_url: None,
            time_zone: "Asia/Tokyo".into(),
            venue: old["venue"].as_str().unwrap().into(),
            capacity: old["capacity"].as_u64().unwrap() as u32,
            talk_minutes: old["talkMinutes"].as_u64().unwrap() as u32,
            transition_minutes: old["transitionMinutes"].as_u64().unwrap() as u32,
            approval_mode: old["approvalMode"].as_str().unwrap().into(),
            planning: old
                .get("planning")
                .map(|value| serde_json::from_value(value.clone()))
                .transpose()?,
            starts_at: instant(start),
            opens_at: instant(start - 7.0 * 86400000.0),
            closes_at: instant(start - 3600000.0),
        }
    } else {
        let data = if create {
            raw.as_object_mut().unwrap().remove("operationId");
            raw.clone()
        } else {
            if !raw.as_object().is_some_and(|o| {
                o.len() == 3 && o.contains_key("data") && o.contains_key("expectedVersion")
            }) {
                return error("VALIDATION", 422);
            }
            raw["data"].clone()
        };
        match serde_json::from_value(data) {
            Ok(s) => s,
            Err(_) => return error("VALIDATION", 422),
        }
    };
    // 相対募集日程は保存時にサーバーでも計算し、開催日変更に追従させる
    if let Some(plan) = &settings.planning {
        if plan.relative_recruitment {
            let Some(open) = crate::planning::before(&settings.starts_at, plan.opens_days_before)
            else {
                return error("VALIDATION", 422);
            };
            let Some(close) = crate::planning::before(&settings.starts_at, plan.closes_days_before)
            else {
                return error("VALIDATION", 422);
            };
            settings.opens_at = open;
            settings.closes_at = close;
        }
    }
    if !valid(&settings) {
        return error("VALIDATION", 422);
    }
    let dto = serde_json::to_string(&settings)?;
    let id = if update {
        p[5].to_owned()
    } else {
        Sha256::digest(format!("{actor}:{op}").as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let before = crate::schedule_notifications::Snapshot::load(db, &id).await?;
    let statement = if update {
        db.prepare("UPDATE lt_event_configs SET dto=?1,actor=?2,operation_id=?3,payload_hash=?4,expected_version=?5 WHERE id=?6").bind(&[dto.into(),actor.into(),op.clone().into(),hash.clone().into(),(expected as f64).into(),id.clone().into()])?
    } else {
        db.prepare("INSERT INTO lt_event_configs(id,dto,actor,operation_id,payload_hash,source_id,source_version) VALUES(?1,?2,?3,?4,?5,?6,?7)").bind(&[id.clone().into(),dto.into(),actor.into(),op.clone().into(),hash.clone().into(),if copy{JsValue::from_str(p[5])}else{JsValue::NULL},if copy{JsValue::from_f64(expected as f64)}else{JsValue::NULL}])?
    };
    // 設定と公開ポスターを同じトランザクションで反映する
    let poster = db.prepare("UPDATE lt_public_events SET dto=CASE WHEN ?1 IS NULL THEN json_remove(dto,'$.posterUrl') ELSE json_set(dto,'$.posterUrl',?1) END WHERE event_id=?2 AND EXISTS(SELECT 1 FROM lt_event_configs c WHERE c.id=?2 AND c.operation_id=?3 AND c.actor=?4)")
        .bind(&[settings.poster_url.as_ref().map(|v| JsValue::from_str(v)).unwrap_or(JsValue::NULL), id.clone().into(), op.clone().into(), actor.into()])?;

    // 受付処理が参照する承認方式も設定と同時に確定する
    let approval = db.prepare("UPDATE lt_recruitment SET approval_mode=?1 WHERE event_id=?2 AND EXISTS(SELECT 1 FROM lt_event_configs c WHERE c.id=?2 AND c.operation_id=?3 AND c.actor=?4)")
        .bind(&[settings.approval_mode.into(), id.clone().into(), op.clone().into(), actor.into()])?;
    let result = db
        .batch(vec![
            statement,
            poster,
            approval,
            before.statement(db, actor, &op, false)?,
        ])
        .await;
    match result {
        Err(e) => {
            if let Some(response) =
                crate::receipts::response(db, "event", actor, &op, &hash, request_id).await?
            {
                return Ok(Some(response));
            }
            let text = e.to_string();
            if text.contains("LT_RECRUITMENT_OVERLAP") {
                return error("RECRUITMENT_CLOSED", 409);
            }
            if text.contains("LT_CAPACITY_FULL") {
                return error("CAPACITY_FULL", 409);
            }
            if text.contains("LT_INVALID_TIMING_CHANGE") {
                return error("INVALID_TRANSITION", 409);
            }
            if text.contains("LT_VERSION_CONFLICT") || text.contains("UNIQUE constraint") {
                return error("VERSION_CONFLICT", 409);
            }
            return Err(e);
        }
        Ok(r) => {
            if r[0].meta()?.unwrap().changes.unwrap_or(0) == 0 {
                return error("NOT_FOUND", 404);
            }
        }
    }
    Ok(Some(Response::from_json(&detail(db, &id).await?.unwrap())?))
}
