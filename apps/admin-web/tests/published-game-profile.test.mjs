import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrustedPublishedAssetUrl,
  loadPublishedGames,
} from "../lib/published-game-profile.ts";
import { DEFAULT_PROFILE_LOCALES } from "../lib/profile-locales.ts";

const digest = "a".repeat(64);

test("profile reuse includes every launcher-supported locale", () => {
  assert.deepEqual([...DEFAULT_PROFILE_LOCALES], ["ja-JP", "en-US"]);
});

function game(gameId, name) {
  return {
    gameId,
    name,
    summary: `${name} summary`,
    heroUrl: `https://downloads.koto-thing.com/v1/assets/sha256/${digest}.png`,
    heroFocalPoint: { x: 0.5, y: 0.4 },
    thumbnailUrl: `https://downloads.koto-thing.com/v1/assets/sha256/${digest}.webp`,
    latestReleaseUrl: `https://downloads.koto-thing.com/v1/games/${gameId}/latest.json`,
  };
}

test("published profiles prefer production and fill missing games from staging", async () => {
  const fetcher = async (url) => {
    if (url.startsWith("https://downloads.koto-thing.com")) {
      return Response.json({ games: [game("shared-game", "Production name")] });
    }
    return Response.json({ games: [game("shared-game", "Staging name"), game("staging-game", "Staging only")] });
  };

  const games = await loadPublishedGames("ja-JP", fetcher);
  assert.deepEqual(games.map(({ gameId, name, environment }) => ({ gameId, name, environment })), [
    { gameId: "shared-game", name: "Production name", environment: "production" },
    { gameId: "staging-game", name: "Staging only", environment: "staging" },
  ]);
});

test("published profiles continue when production catalog is unavailable", async () => {
  const fetcher = async (url) => url.startsWith("https://downloads.koto-thing.com")
    ? new Response("missing", { status: 404 })
    : Response.json({ games: [game("staging-game", "Staging only")] });

  const games = await loadPublishedGames("ja-JP", fetcher);
  assert.equal(games[0].environment, "staging");
});

test("published asset URL validation rejects SSRF and mutable paths", () => {
  assert.equal(
    isTrustedPublishedAssetUrl(`https://downloads.koto-thing.com/v1/assets/sha256/${digest}.jpg`),
    true,
  );
  assert.equal(isTrustedPublishedAssetUrl("https://evil.example/v1/assets/sha256/file.png"), false);
  assert.equal(isTrustedPublishedAssetUrl("https://downloads.koto-thing.com/v1/catalog/ja-JP/windows/x86_64.json"), false);
});
