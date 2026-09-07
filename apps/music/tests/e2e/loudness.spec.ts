import { test, expect } from "@playwright/test";
import type { PublicGame } from "../../src/domain/models";

test("existing audio can be measured, saved, reloaded and previewed", /** @brief 既存音源を再送せず、管理画面から実WASMで測定する */ async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8788/api/auth/dev?as=music-a");
  await page.goto("http://127.0.0.1:8788/music#/manage");
  test.skip(
    !(await page.evaluate(
      /** @brief 実際のブラウザーの音声解析能力を確認する */ () =>
        typeof OfflineAudioContext !== "undefined",
    )),
    "この環境にはOfflineAudioContextがありません。",
  );
  await page.locator(".manage-list a").filter({ hasText: "DEMO 1 /" }).click();
  await page.locator('a[href*="/manage/tracks/"]').first().click();
  await page
    .getByRole("button", { name: "音量を測定する", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "測定済み：" }),
  ).toContainText("LUFS");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下書きを保存", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "測定済み：" }),
  ).toContainText("LUFS");
  await page
    .getByRole("button", { name: "▶ 下書きを試聴", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
});

test("streaming and region playback share the same gain and reset on track change", /** @brief 実HTML音声とPCMループの出力振幅、曲切替、再開を確認する */ async ({
  page,
}) => {
  await page.goto("/");
  test.skip(
    !(await page.evaluate(
      /** @brief Web Audioがある環境で実出力を検証する */ () =>
        typeof AudioContext !== "undefined",
    )),
    "この環境にはWeb Audioがありません。",
  );
  const games = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  const result = await page.evaluate(
    /** @brief 実ノードの出力をAnalyserで測り、単なる設定値の検査にしない */ async (
      track,
    ) => {
      const moduleUrl = "/__test/audio.js";
      const { BrowserAudio, PLAYER_RUNTIME_DEFAULTS } = await import(
        /* @vite-ignore */ moduleUrl
      );
      const engine = new BrowserAudio(
        PLAYER_RUNTIME_DEFAULTS,
        /** @brief 公開済みの同一origin音源を使う */ (id: string) =>
          `/api/assets/${id}`,
      );
      engine.load({
        ...track,
        loudness: {
          audioAssetId: track.audioAssetId,
          integratedLufs: -12,
          truePeakDbtp: -3,
        },
      });
      await engine.play();
      const analyser = engine.context.createAnalyser();
      analyser.fftSize = 2048;
      engine.output.connect(analyser);
      /** @brief 音声レンダーが進んだ後に実振幅を取得する */
      async function amplitude() {
        await new Promise(
          /** @brief 実オーディオスレッドの入力を待つ */ (resolve) =>
            setTimeout(resolve, 150),
        );
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map(Math.abs));
      }
      const streaming = await amplitude();
      await engine.setRegion({ startSeconds: 1, endSeconds: 3 });
      const region = await amplitude();
      engine.pause();
      await engine.play();
      const resumed = await amplitude();
      engine.load({ ...track, loudness: undefined });
      await engine.play();
      const uncorrected = await amplitude();
      const gain = engine.output.gain.value;
      engine.dispose();
      return { streaming, region, resumed, uncorrected, gain };
    },
    games[0].tracks[0],
  );
  expect(result.streaming).toBeGreaterThan(0.02);
  expect(result.region / result.streaming).toBeCloseTo(1, 1);
  expect(result.resumed / result.streaming).toBeCloseTo(1, 1);
  expect(result.streaming / result.uncorrected).toBeCloseTo(10 ** (-6 / 20), 1);
  expect(result.gain).toBe(1);
});
