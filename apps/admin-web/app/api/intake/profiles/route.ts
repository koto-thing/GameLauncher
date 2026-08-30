import { requireUploaderActor } from "@/lib/auth";
import { DEFAULT_PROFILE_LOCALES } from "@/lib/profile-locales";
import { loadPublishedGames } from "@/lib/published-game-profile";

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

export async function GET(request: Request) {
  try {
    await requireUploaderActor(request);
    const url = new URL(request.url);
    const gameId = url.searchParams.get("gameId")?.trim();
    if (!gameId) {
      const games = await loadPublishedGames("ja-JP");
      return Response.json({
        games: games.map(({ gameId: id, name, environment }) => ({ gameId: id, name, environment })),
      });
    }

    const requestedLocales = (url.searchParams.get("locales") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const locales = [...new Set([...DEFAULT_PROFILE_LOCALES, ...requestedLocales])];
    if (locales.length > 10 || locales.some((locale) => !LOCALE_PATTERN.test(locale))) {
      return Response.json({ error: "言語タグが不正です" }, { status: 400 });
    }

    const matches = await Promise.all(locales.map(async (locale) => ({
      locale,
      game: (await loadPublishedGames(locale)).find((candidate) => candidate.gameId === gameId),
    })));
    const primary = matches.find(({ game }) => game)?.game;
    if (!primary) return Response.json({ error: "公開済みゲームが見つかりません" }, { status: 404 });

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
    if (error instanceof Response) return error;
    return Response.json({ error: "公開済みゲーム情報を取得できませんでした" }, { status: 502 });
  }
}
