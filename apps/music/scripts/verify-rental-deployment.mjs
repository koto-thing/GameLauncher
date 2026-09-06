import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve("build/browsers");
const { chromium, expect } = await import("@playwright/test");
const origin = "https://pandd-music.koto-thing.com";
const gameId = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(gameId ?? ""))
  throw new Error("Specify a published verification game ID");
const browser = await chromium.launch();
const requests = [],
  errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on(
    "request",
    /** @brief 通常閲覧と再生の通信先を記録する。 */ (request) =>
      requests.push(request.url()),
  );
  page.on(
    "pageerror",
    /** @brief 未処理例外を検証結果へ残す。 */ (error) =>
      errors.push(error.message),
  );
  const response = await page.request.get(`${origin}/api/public/catalogue`);
  assert.equal(response.status(), 200);
  assert.match(response.headers()["cache-control"], /no-store/);
  const games = await response.json();
  const game = games.find(
    /** @brief 実作品を触らず指定された確認作品だけを読む。 */ (value) =>
      value.id === gameId,
  );
  assert.ok(game?.tracks.length);
  const track = game.tracks[0];
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "サウンドトラック", exact: true }),
  ).toBeVisible();
  await page.goto(`${origin}/tracks/${track.id}`);
  await expect(
    page.getByRole("heading", { name: track.title, exact: true }),
  ).toBeVisible();
  const artwork = page.locator(".listening-image img");
  await expect
    .poll(
      /** @brief 曲画像が実際にデコードされたことを確認する。 */ () =>
        artwork.evaluate(
          /** @brief 画像の読込結果を取得する。 */ (image) =>
            image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  assert.equal(
    await page.evaluate(
      /** @brief スマホの横溢れを検出する。 */ () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await page.getByLabel("リピート", { exact: true }).selectOption("region");
  await page.waitForTimeout(4600);
  const position = Number(
    await page.getByLabel("再生位置", { exact: true }).inputValue(),
  );
  assert.ok(
    position >= track.loop.startSeconds && position < track.loop.endSeconds,
  );
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  const asset = `${origin}/api/assets/${track.audioAssetId}`;
  assert.equal((await page.request.head(asset)).status(), 200);
  const range = await page.request.get(asset, {
    headers: { Range: "bytes=0-43" },
  });
  assert.equal(range.status(), 206);
  assert.equal((await range.body()).length, 44);
  assert.match(range.headers()["cache-control"], /no-store/);
  for (const privatePath of [
    "/.user.ini",
    "/config/local.php",
    "/src/bootstrap.php",
    "/vendor/autoload.php",
    "/pandd-music-private/app/config/local.php",
  ]) {
    assert.ok(
      [403, 404].includes(
        (await page.request.get(origin + privatePath)).status(),
      ),
      privatePath,
    );
  }
  const external = requests.filter(
    /** @brief Workersを含む外部通信を検出する。 */ (url) =>
      new URL(url).origin !== origin,
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await mkdir("build", { recursive: true });
  await page.screenshot({
    path: "build/rental-production-390.png",
    fullPage: true,
  });
  await writeFile(
    "build/rental-production-verification.json",
    JSON.stringify(
      {
        origin,
        gameId,
        trackId: track.id,
        audioAssetId: track.audioAssetId,
        requests,
        external,
        errors,
        loopPositionSeconds: position,
        rangeStatus: range.status(),
        result: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "passed",
      browserRequests: requests.length,
      external: external.length,
      range: range.status(),
      loopPositionSeconds: position,
    }),
  );
} finally {
  await browser.close();
}
