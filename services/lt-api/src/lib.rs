use worker::*;

/// 未実装 API を成功扱いせず拒否する Worker 入口
/// 引数: HTTP リクエスト、環境、実行コンテキスト
/// 戻り値: キャッシュされない HTTP 応答
#[event(fetch)]
pub async fn main(req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    // 公衆入口には運営操作を登録しない
    let path = req.path();
    let response = if path.starts_with("/api/lt/v1/operator/") {
        Response::error("Not found", 404)?
    } else if path == "/auth/verify" && req.method() == Method::Get {
        // GET は token を読まず消費もしない
        Response::from_html("<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><title>確認</title><p>確認機能は準備中です</p></html>")?
    } else {
        Response::error("LT API is not implemented", 501)?
    };

    // 私有情報や確認 URL をキャッシュ・参照元へ残さない
    let mut response = response;
    response.headers_mut().set("Cache-Control", "no-store")?;
    response.headers_mut().set("Referrer-Policy", "no-referrer")?;
    response.headers_mut().set("X-Content-Type-Options", "nosniff")?;
    Ok(response)
}
