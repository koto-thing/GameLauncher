import { requireUploaderActor } from "@/lib/auth";
import { isTrustedPublishedAssetUrl } from "@/lib/published-game-profile";

/**
 * 認証付き画像プロキシの API エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function GET(request: Request) {
  try {
    // 画像を代理取得できる権限を持っているかを検証する
    // 未認証や権限不足の場合は、例外または、Response を投げる
    await requireUploaderActor(request);

    // クエリパラメータを取得
    const sourceUrl = new URL(request.url).searchParams.get("url") ?? "";
    // 指定された URL が信頼できる公開アセットのオリジンに該当するかを厳格にチェック
    // 不正な URL や未許可のホストへのリクエストは HTTP 400で遮断
    if (!isTrustedPublishedAssetUrl(sourceUrl)) {
      return Response.json({ error: "画像URLが不正です" }, { status: 400 });
    }

    // 画像をダウンロード
    // 取得に失敗した場合、HTTP 502を返す
    const source = await fetch(sourceUrl, { headers: { accept: "image/*" } });
    if (!source.ok || !source.body) {
      return Response.json({ error: "公開済み画像を取得できませんでした" }, { status: 502 });
    }

    // 取得先が返した content-type を取得して、画像であるかを検証
    // 画像でない場合は、HTTP 502を返す
    const contentType = source.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "公開済みファイルは画像ではありません" }, { status: 502 });
    }

    // 取得した source.body をメモリに全展開せず、そのままストリーミングでクライアントへ中継してメモリ負荷を抑える
    return new Response(source.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    // requiredUploaderActor が投げた認証・認可エラーをそのまま返す
    if (error instanceof Response) return error;

    // それ以外は HTTP 502として返す
    return Response.json({ error: "公開済み画像を取得できませんでした" }, { status: 502 });
  }
}
