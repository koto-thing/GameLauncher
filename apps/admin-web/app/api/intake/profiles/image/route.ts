import { requireUploaderActor } from "@/lib/auth";
import { isTrustedPublishedAssetUrl } from "@/lib/published-game-profile";

export async function GET(request: Request) {
  try {
    await requireUploaderActor(request);
    const sourceUrl = new URL(request.url).searchParams.get("url") ?? "";
    if (!isTrustedPublishedAssetUrl(sourceUrl)) {
      return Response.json({ error: "画像URLが不正です" }, { status: 400 });
    }
    const source = await fetch(sourceUrl, { headers: { accept: "image/*" } });
    if (!source.ok || !source.body) {
      return Response.json({ error: "公開済み画像を取得できませんでした" }, { status: 502 });
    }
    const contentType = source.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "公開済みファイルは画像ではありません" }, { status: 502 });
    }
    return new Response(source.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "公開済み画像を取得できませんでした" }, { status: 502 });
  }
}
