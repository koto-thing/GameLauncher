export const PUBLISHED_GAME_ENVIRONMENTS = [
  { environment: "production", baseUrl: "https://downloads.koto-thing.com" },
  { environment: "staging", baseUrl: "https://pub-1ada658d7c4f46b1bf109646a4a68bcb.r2.dev" },
] as const;

export type PublishedEnvironment = typeof PUBLISHED_GAME_ENVIRONMENTS[number]["environment"];

export type PublishedGame = {
  gameId: string;
  name: string;
  summary: string;
  heroUrl: string;
  heroFocalPoint: { x: number; y: number };
  thumbnailUrl: string;
};

type Catalog = { games?: unknown };

function isPublishedGame(value: unknown): value is PublishedGame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const focalPoint = item.heroFocalPoint as Record<string, unknown> | undefined;
  return typeof item.gameId === "string" && typeof item.name === "string" &&
    typeof item.summary === "string" && typeof item.heroUrl === "string" &&
    typeof item.thumbnailUrl === "string" && Boolean(focalPoint) &&
    typeof focalPoint?.x === "number" && focalPoint.x >= 0 && focalPoint.x <= 1 &&
    typeof focalPoint?.y === "number" && focalPoint.y >= 0 && focalPoint.y <= 1 &&
    isTrustedPublishedAssetUrl(item.heroUrl) && isTrustedPublishedAssetUrl(item.thumbnailUrl);
}

export async function loadPublishedGames(
  locale: string,
  fetcher: typeof fetch = fetch,
): Promise<Array<PublishedGame & { environment: PublishedEnvironment }>> {
  const games = new Map<string, PublishedGame & { environment: PublishedEnvironment }>();
  for (const source of PUBLISHED_GAME_ENVIRONMENTS) {
    const url = `${source.baseUrl}/v1/catalog/${encodeURIComponent(locale)}/windows/x86_64.json`;
    try {
      const response = await fetcher(url, { headers: { accept: "application/json" } });
      if (!response.ok) continue;
      const catalog = await response.json() as Catalog;
      if (!Array.isArray(catalog.games)) continue;
      for (const game of catalog.games) {
        if (isPublishedGame(game) && !games.has(game.gameId)) {
          games.set(game.gameId, { ...game, environment: source.environment });
        }
      }
    } catch {
      // One unavailable environment must not hide profiles from the other one.
    }
  }
  return [...games.values()].sort((left, right) => left.gameId.localeCompare(right.gameId));
}

export function isTrustedPublishedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const trustedOrigin = PUBLISHED_GAME_ENVIRONMENTS.some(
      (source) => new URL(source.baseUrl).origin === url.origin,
    );
    return trustedOrigin && /^\/v1\/assets\/sha256\/[0-9a-f]{64}\.(?:png|jpe?g|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
