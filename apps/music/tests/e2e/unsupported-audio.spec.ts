import { test, expect } from "@playwright/test";
import type { PublicGame } from "../../src/domain/models";

test("unavailable Web Audio gives an explanation and permits normal playback", /** @brief 非対応環境で未処理例外や偽のループONを表示しない。 */ async ({
  page,
}) => {
  await page.addInitScript(
    /** @brief Web Audioなしの環境を全ブラウザーで再現する。 */ () => {
      Object.defineProperty(window, "AudioContext", {
        value: undefined,
        configurable: true,
      });
    },
  );
  const errors: string[] = [];
  page.on(
    "pageerror",
    /** @brief UIイベントの非同期例外も検出する。 */ (error) =>
      errors.push(error.message),
  );
  const games = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  await page.goto(`/tracks/${games[0].tracks[0].id}`);
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.getByLabel("リピート", { exact: true }).selectOption("region");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "このブラウザー環境はWeb Audio" }),
  ).toBeVisible();
  await expect(page.getByLabel("リピート", { exact: true })).toHaveValue("off");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("late playing event cannot clear a stopped player's error", /** @brief 停止前に予約されたイベントの配送順を再現する。 */ async ({ page }) => {
  await page.goto("/");
  const games = (await (await page.request.get("/api/public/catalogue")).json()) as PublicGame[];
  const snapshot = await page.evaluate(
    /** @brief 実HTMLAudioElementを停止した後に古いplaying通知を配送する。 */ async (track) => {
      const moduleUrl = "/__test/audio.js";
      const { BrowserAudio, PLAYER_RUNTIME_DEFAULTS } = await import(/* @vite-ignore */ moduleUrl);
      Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
      const engine = new BrowserAudio(PLAYER_RUNTIME_DEFAULTS, /** @brief 公開素材URLを解決する。 */ (id: string) => `/api/assets/${id}`);
      engine.load(track);
      await engine.setRegion(track.loop);
      engine.audio.dispatchEvent(new Event("playing"));
      engine.audio.dispatchEvent(new Event("pause"));
      const result = engine.snapshot();
      engine.dispose();
      return result;
    },
    games[0].tracks[0],
  );
  expect(snapshot.status).toBe("error");
  expect(snapshot.error).toContain("このブラウザー環境はWeb Audio");
});
