use serde_json::{Value, json};
use std::collections::BTreeMap;
use worker::*;

struct Parent {
    state: Value,
    cancelled: Value,
    publish: bool,
    expires: Option<f64>,
    now: f64,
}
impl Parent {
    /// 同一request内の親状態を読み取る
    /// 引数: DB、開催ID
    /// 戻り値: 親状態
    async fn load(db: &D1Database, id: &str) -> Result<Self> {
        let rows=db.prepare("SELECT state,cancelled_at,publish_enabled,private_expires FROM lt_events WHERE id=?1").bind(&[id.into()])?.all().await?.results::<Value>()?;
        let row = rows
            .first()
            .ok_or_else(|| Error::RustError("LT_NOT_FOUND".into()))?;
        Ok(Self {
            state: row["state"].clone(),
            cancelled: row["cancelled_at"].clone(),
            publish: row["publish_enabled"] == 1,
            expires: row["private_expires"].as_f64(),
            now: crate::lifecycle::now(db).await?,
        })
    }
    /// 古いreceiptにも現在の親状態と期限を合成する
    /// 引数: DTO、運営フラグ
    /// 戻り値: 期限内の具体DTO
    fn app(&self, value: &Value, operator: bool) -> Option<Value> {
        if self.expires.is_some_and(|v| v <= self.now) {
            return None;
        }
        let mut dto = value.clone();
        dto["eventState"] = self.state.clone();
        dto["eventCancelledAt"] = self.cancelled.clone();
        if let Some(expires) = self.expires {
            dto["retentionExpiresAt"] = json!(
                js_sys::Date::new(&expires.into())
                    .to_iso_string()
                    .as_string()?
            );
        }
        if crate::applicant::expired(&dto, self.now) {
            return None;
        }
        if operator {
            crate::applicant_dto::operator(&dto)
        } else {
            crate::applicant_dto::sanitize(&dto)
        }
    }
}

/// 単一申請の最新親状態を合成する
/// 引数: DB、保存DTO、運営フラグ
/// 戻り値: 具体DTOまたは期限エラー
pub async fn app(db: &D1Database, value: &Value, operator: bool) -> Result<Value> {
    app_inner(db, value, operator, None).await
}

/// 本人応答は現在の所有者を再確認してから構成する
/// 引数: DB、保存DTO、認証メール
/// 戻り値: 本人DTOまたは所有者変更エラー
pub async fn owned(db: &D1Database, value: &Value, owner: &str) -> Result<Value> {
    app_inner(db, value, false, Some(owner)).await
}

/// 現在ownerと保持期限を同じ応答構成で検査する
/// 引数: DB、DTO、運営フラグ、任意本人メール
/// 戻り値: 許可DTO
async fn app_inner(
    db: &D1Database,
    value: &Value,
    operator: bool,
    expected_owner: Option<&str>,
) -> Result<Value> {
    let mut value = value.clone();
    let owner = db
        .prepare("SELECT email FROM lt_applications WHERE id=?1")
        .bind(&[value["id"].as_str().unwrap().into()])?
        .all()
        .await?
        .results::<Value>()?;
    if let Some(owner) = owner.first() {
        if expected_owner.is_some_and(|expected| owner["email"] != expected) {
            return Err(Error::RustError("LT_OWNER_MOVED".into()));
        }
        value["representativeEmail"] = owner["email"].clone();
    } else if expected_owner.is_some() {
        return Err(Error::RustError("LT_OWNER_MOVED".into()));
    }
    Parent::load(
        db,
        value["eventId"]
            .as_str()
            .ok_or_else(|| Error::RustError("Invalid application".into()))?,
    )
    .await?
    .app(&value, operator)
    .ok_or_else(|| Error::RustError("LT_RETENTION_EXPIRED".into()))
}

/// 一覧に現在親状態を合成し、期限後の申請を除外する
/// 引数: DB、保存DTO一覧、運営フラグ
/// 戻り値: 具体DTO一覧
pub async fn list(db: &D1Database, values: Vec<Value>, operator: bool) -> Result<Vec<Value>> {
    let mut parents = BTreeMap::new();
    let mut out = Vec::new();
    for value in values {
        let id = value["eventId"]
            .as_str()
            .ok_or_else(|| Error::RustError("Invalid application".into()))?
            .to_owned();
        if !parents.contains_key(&id) {
            parents.insert(id.clone(), Parent::load(db, &id).await?);
        }
        if let Some(dto) = parents[&id].app(&value, operator) {
            out.push(dto)
        }
    }
    Ok(out)
}

/// 設定receiptにも最新の状態と公開可否を合成する
/// 引数: DB、設定DTO
/// 戻り値: 現在親状態付き設定
pub async fn event(db: &D1Database, value: &Value) -> Result<Value> {
    let parent = Parent::load(
        db,
        value["id"]
            .as_str()
            .ok_or_else(|| Error::RustError("Invalid event".into()))?,
    )
    .await?;
    if parent.expires.is_some_and(|v| v <= parent.now) {
        return Err(Error::RustError("LT_RETENTION_EXPIRED".into()));
    }
    let mut dto = value.clone();
    dto["state"] = parent.state;
    dto["publishEnabled"] = json!(parent.publish);
    Ok(dto)
}
