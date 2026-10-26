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
