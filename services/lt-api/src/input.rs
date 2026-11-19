use futures_util::StreamExt;
use serde::de::DeserializeOwned;
use worker::*;

/// JSON本文を64KiBまでストリームで読み、Rustで一度だけ解析する
/// 引数: request
/// 戻り値: 具体入力型または検証エラー
pub async fn json<T: DeserializeOwned>(req: &mut Request) -> Result<T> {
    const MAX: usize = 64 * 1024;
    // 長さが既知なら読み取り前に拒否し、不明な場合もchunkごとに上限を守る
    if req
        .headers()
        .get("Content-Length")?
        .is_some_and(|s| s.parse::<usize>().map_or(true, |n| n > MAX))
    {
        return Err(Error::RustError("JSON body exceeds limit".into()));
    }
    let mut stream = req.stream()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len() + chunk.len() > MAX {
            return Err(Error::RustError("JSON body exceeds limit".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

/// UTC ミリ秒表記の契約時刻を Unix 時刻に変換する
///
/// # 引数
/// - `s` - UTC のミリ秒精度を表す時刻文字列
///
/// # 戻り値
/// Unix エポックからのミリ秒、形式または日時が不正なら None
pub(crate) fn millis(s: &str) -> Option<i64> {
    if s.len() != 24 || !s.ends_with('Z') || s.as_bytes()[19] != b'.' {
        return None;
    }

    // 秒と秒内のミリ秒を合わせてエポック以前の時刻にも対応する
    let date =
        time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()?;
    Some(date.unix_timestamp() * 1000 + i64::from(date.millisecond()))
}
