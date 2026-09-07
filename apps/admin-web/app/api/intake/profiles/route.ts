import { requireUploaderActor } from "@/lib/auth";
import { DEFAULT_PROFILE_LOCALES } from "@/lib/profile-locales";
import { loadPublishedGames } from "@/lib/published-game-profile";

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

/**
 * 公開済みゲーム情報を取得する API エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function GET(request: Request) {
  try {
    // 管理画面・編集画面でアップロード権限を持つユーザーのみがアクセスできるようにガード
    await requireUploaderActor(request);
    const url = new URL(request.url);

    const gameId = url.searchParams.get("gameId")?.trim();
    // クエリパラメータに gameId が指定されていない場合、デフォルトロケールで公開済みゲーム一覧を取得する
    // レスポンス容量を抑えるため、ゲームID、名前、動作環境のみを抽出して返す
    if (!gameId) {
      const games = await loadPublishedGames("ja-JP");
      return Response.json({
        games: games.map(({ gameId: id, name, environment }) => ({ gameId: id, name, environment })),
      });
    }

    // クエリパラメータなどからカンマ区切りで言語リストを取得
    const requestedLocales = (url.searchParams.get("locales") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    // デフォルトロケールとリクエストされたロケールをマージして、重複を排除
    const locales = [...new Set([...DEFAULT_PROFILE_LOCALES, ...requestedLocales])];
    // 言語数が最大10個を超えていないかをチェック (Dos対策)
    // LOCALEPATTERN に適合しているかをチェック
    if (locales.length > 10 || locales.some((locale) => !LOCALE_PATTERN.test(locale))) {
      return Response.json({ error: "言語タグが不正です" }, { status: 400 });
    }

    // 各ロケールごとの公開ゲーム情報を並列に取得・走査して、対象 gameId に一致するデータを集める
    const matches = await Promise.all(locales.map(async (locale) => ({
      locale,
      game: (await loadPublishedGames(locale)).find((candidate) => candidate.gameId === gameId),
    })));
    // 指定した gameId のデータがいずれのロケールにも存在しない場合、HTTP 404を返す
    const primary = matches.find(({ game }) => game)?.game;
    if (!primary) return Response.json({ error: "公開済みゲームが見つかりません" }, { status: 404 });

    // 翻訳データと画像メタデータをまとめて返す
    return Response.json({
      gameId,
      environment: primary.environment,
      translations: Object.fromEntries(matches.flatMap(({ locale, game }) =>
        game ? [[locale, { name: game.name, summary: game.summary }]] : []
      )),
      heroUrl: primary.heroUrl,
      thumbnailUrl: primary.thumbnailUrl,
      heroFocalPoint: primary.heroFocalPoint,
    });
  } catch (error) {
    // requiredUploaderActor が例外を投げたらそのまま返す
    if (error instanceof Response) return error;

    // それ以外は HTTP 502を返す
    return Response.json({ error: "公開済みゲーム情報を取得できませんでした" }, { status: 502 });
  }
}
