import { test, expect } from "@playwright/test";
import type { PublicGame } from "../../src/domain/models";

test("rapid switches, stale loop preparation, memory budget and interruption recover safely", /** @brief 実AudioContextで競合とメモリ制限を再現する。 */ async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "作品を選んで聴く" }).click();
  const games = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  test.skip(
    !(await page.evaluate(
      /** @brief Windows版WebKitに存在しないAPIを成功として扱わない。 */ () =>
        typeof AudioContext !== "undefined",
    )),
    "この実行環境にはWeb Audio APIがありません。実Safariでの音声確認が必要です。",
  );
  const results = await page.evaluate(
    /** @brief モック音声エンジンを使わず実装の状態とNode寿命を観測する。 */ async (
      tracks,
    ) => {
      const audioModule = "/__test/audio.js";
      const configModule = "/__test/audio.js";
      const { BrowserAudio } = await import(/* @vite-ignore */ audioModule);
      const { PLAYER_RUNTIME_DEFAULTS } = await import(
        /* @vite-ignore */ configModule
      );
      const engine = new BrowserAudio(PLAYER_RUNTIME_DEFAULTS, /** @brief 公開素材URLだけをエンジンへ渡す。 */ (id: string) => `/api/assets/${id}`);
      const track = tracks[0];
      const second = tracks[1];
      engine.load(track);
      const pending = engine.setRegion(track.loop);
      engine.load(second);
      await pending;
      const stale = engine.snapshot();
      const noOldBuffer = engine.buffer === null && engine.source === null;
      // 区間準備後もページごとにエンジンが増えない。切替は同じインスタンスで繰り返す。
      for (let count = 0; count < 8; count++) {
        engine.load(track);
        await engine.setRegion(track.loop);
        engine.load(second);
      }
      const released = engine.buffer === null && engine.source === null;
      engine.load(track);
      await engine.play();
      await engine.setRegion(track.loop);
      await engine.context.suspend();
      // suspendのPromise解決とstatechangeイベントは別タスクなので、実際の通知を待って評価する。
      await new Promise(
        /** @brief ブラウザーの状態イベントを配送させる。 */ (resolve) =>
          setTimeout(resolve, 50),
      );
      const interrupted = engine.snapshot();
      await engine.play();
      const resumed = engine.snapshot();
      engine.pause();
      engine.dispose();
      const limited = new BrowserAudio({
        ...PLAYER_RUNTIME_DEFAULTS,
        decodedAudioBudgetBytes: 32,
      }, /** @brief 公開素材URLだけをエンジンへ渡す。 */ (id: string) => `/api/assets/${id}`);
      limited.load(track);
      await limited.setRegion(track.loop);
      const budget = limited.snapshot();
      await limited.play();
      const recovered = limited.snapshot();
      limited.dispose();
      return {
        stale,
        noOldBuffer,
        released,
        interrupted,
        resumed,
        budget,
        recovered,
      };
    },
    games[0].tracks,
  );
  expect(results.stale.regionActive).toBe(false);
  expect(results.noOldBuffer).toBe(true);
  expect(results.released).toBe(true);
  expect(results.interrupted.status).toBe("interrupted");
  expect(results.resumed.status).toBe("playing");
  expect(results.budget.status).toBe("error");
  expect(results.budget.error).toContain("メモリ予算");
  expect(results.recovered.status).toBe("playing");
});
