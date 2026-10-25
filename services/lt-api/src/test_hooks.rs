use serde_json::Value;
use worker::*;

/// 異種操作race用ビルドだけで読取済み時刻を記録し短時間待機する
/// 引数: 認証済みrequest、読取済みDTO
/// 戻り値: 観測した公開時刻（通常ビルドには存在しない）
pub async fn pause(req: &Request, dto: &Value) -> Result<Option<String>> {
    if req.headers().get("X-LT-Test-Pause")?.as_deref() != Some("after-read") {
        return Ok(None);
    }
    let value = dto["published"]["startsAt"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    Delay::from(std::time::Duration::from_millis(700)).await;
    Ok(Some(value))
}

/// テストで観測した読取値を応答ヘッダーへ付ける
/// 引数: 応答、観測値
/// 戻り値: 試験専用観測付き応答
pub fn annotate(mut response: Response, value: Option<String>) -> Result<Response> {
    if let Some(value) = value {
        response
            .headers_mut()
            .set("X-LT-Test-Observed-Start", &value)?;
    }
    Ok(response)
}

/// 試験専用ポートからだけfake mailboxを取得する
/// 引数: 架空recipient、内部環境
/// 戻り値: 期限内のfake確認link（ログへは出力しない）
#[worker::wasm_bindgen::prelude::wasm_bindgen]
pub async fn fake_mail(
    email: String,
    env: Env,
) -> std::result::Result<String, worker::wasm_bindgen::JsValue> {
    use worker::wasm_bindgen::JsValue;
    if !cfg!(feature = "local-development")
        || env
            .var("LOCAL_AUTH")
            .map(|v| v.to_string())
            .unwrap_or_default()
            != "true"
    {
        return Err(JsValue::from_str("Disabled"));
    }
    let db = env
        .d1("DB")
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let rows=db.prepare("SELECT confirmation_url FROM lt_fake_mail WHERE recipient=?1 AND expires>unixepoch('subsec')*1000 ORDER BY rowid DESC LIMIT 1").bind(&[email.into()]).map_err(|e|JsValue::from_str(&e.to_string()))?.all().await.map_err(|_|JsValue::from_str("Fake mailbox unavailable"))?.results::<Value>().map_err(|_|JsValue::from_str("Invalid fake mailbox"))?;
    rows.first()
        .and_then(|r| r["confirmation_url"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| JsValue::from_str("Fake mailbox empty"))
}
