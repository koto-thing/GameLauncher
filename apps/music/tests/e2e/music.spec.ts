import { test, expect } from "@playwright/test";
import { placeholderPng, toneWav } from "../support/fixtures.mjs";
import type { PublicGame } from "../../src/domain/models";

test("home, direct links, mobile widths and artwork aspect ratios", /** @brief スマホ幅とPCで実ページと操作の表示を確認する。 */ async ({
  page,
}, info) => {
  const failures: string[] = [];
  page.on(
    "pageerror",
    /** @brief コンソールではなく未処理例外を記録する。 */ (error) =>
      failures.push(error.message),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "サウンドトラック", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".game-card")).toHaveCount(2);
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        /** @brief ページ全体の横溢れを測定する。 */ () =>
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `build/home-${info.project.name}-390.png`,
    fullPage: true,
  });
  await page.locator(".game-card").first().click();
  await expect(page.locator(".track-list li")).toHaveCount(3);
  await page.locator(".track-list a").nth(1).click();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".mini-player")).toHaveCount(0);
  const image = page.locator(".listening-image img");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      /** @brief 縦画像を正方形へ切り抜いていないことを確認する。 */ (
        element: HTMLImageElement,
      ) =>
        Math.abs(
          element.clientWidth / element.clientHeight -
            element.naturalWidth / element.naturalHeight,
        ) < 0.02 || getComputedStyle(element).objectFit === "contain",
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await page.goBack();
  expect(failures).toEqual([]);
});
test("playback survives navigation and game loop can pause, seek and disable", /** @brief 実音声状態と表示・画面遷移を確認する。 */ async ({
  page,
}) => {
  await page.goto("/");
  test.skip(
    !(await page.evaluate(
      /** @brief 実際に備わる音声APIだけを検証する。 */ () =>
        typeof AudioContext !== "undefined",
    )),
    "この実行環境にWeb Audioがないためループ動作は未検証です。",
  );
  const games = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  const game = games[0];
  const track = game.tracks[0];
  await page.goto(`/tracks/${track.id}`);
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await page.getByLabel("リピート", { exact: true }).selectOption("region");
  await expect(page.getByLabel("リピート", { exact: true })).toHaveValue(
    "region",
  );
  await page.waitForTimeout(4600);
  const seconds = Number(
    await page.getByLabel("再生位置", { exact: true }).inputValue(),
  );
  expect(seconds).toBeGreaterThanOrEqual(1);
  expect(seconds).toBeLessThan(3);
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  const paused = Number(
    await page.getByLabel("再生位置", { exact: true }).inputValue(),
  );
  await page.waitForTimeout(300);
  expect(
    Number(await page.getByLabel("再生位置", { exact: true }).inputValue()),
  ).toBeCloseTo(paused, 1);
  await page.getByLabel("再生位置", { exact: true }).fill("3.5");
  expect(
    Number(await page.getByLabel("再生位置", { exact: true }).inputValue()),
  ).toBeCloseTo(1, 1);
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.getByRole("link", { name: "ライブラリ", exact: true }).click();
  await expect(page.locator(".mini-player")).toContainText(track.title);
  await page
    .getByRole("link", { name: "このサイトについて", exact: true })
    .click();
  await expect(page.locator(".mini-player")).toContainText(track.title);
  await page.locator(".mini-info").click();
  await expect(page.getByLabel("リピート", { exact: true })).toHaveValue(
    "region",
  );
  await page.getByLabel("リピート", { exact: true }).selectOption("off");
  await expect(page.getByLabel("リピート", { exact: true })).toHaveValue("off");
  await page.waitForTimeout(4100);
  await expect(page.locator(".mini-player")).toContainText(
    game.tracks[1].title,
  );
});
test("same production loop scheduler renders intro once and ten exact repeats", /** @brief モックでなくOfflineAudioContextの波形を全サンプル比較する。 */ async ({
  page,
}) => {
  await page.goto("/");
  test.skip(
    !(await page.evaluate(
      /** @brief OfflineAudioContext不在を合格に読み替えない。 */ () =>
        typeof OfflineAudioContext !== "undefined",
    )),
    "この実行環境にはOfflineAudioContextがありません。",
  );
  const result = await page.evaluate(
    /** @brief 実エンジン共通のNode構成をオフライン音声レンダラーで測定する。 */ async () => {
      const modulePath = "/src/infrastructure/audio/region-source.ts";
      const { startRegionSource } = await import(/* @vite-ignore */ modulePath);
      const sampleRate = 24000;
      const duration = 23;
      const context = new OfflineAudioContext(
        1,
        sampleRate * duration,
        sampleRate,
      );
      const buffer = context.createBuffer(1, sampleRate * 4, sampleRate);
      const original = buffer.getChannelData(0);
      for (let index = 0; index < original.length; index++)
        original[index] =
          index < sampleRate
            ? 0.12
            : index < sampleRate * 3
              ? 0.2 + 0.1 * Math.sin((2 * Math.PI * 240 * index) / sampleRate)
              : -0.3;
      // FirefoxはSourceが取得したBufferの元ArrayBufferをdetachするため、期待波形は先に複写する。
      const expected = original.slice();
      startRegionSource(
        context,
        buffer,
        { startSeconds: 1, endSeconds: 3 },
        0,
        context.destination,
      );
      const output = (await context.startRendering()).getChannelData(0);
      let maxError = 0;
      for (let index = 0; index < output.length; index++) {
        const source =
          index < 3 * sampleRate
            ? index
            : sampleRate + ((index - 3 * sampleRate) % (2 * sampleRate));
        maxError = Math.max(
          maxError,
          Math.abs(output[index] - expected[source]),
        );
      }
      return {
        samples: output.length,
        maxError,
        firstSample: output[0],
        repeats: (duration - 3) / 2,
      };
    },
  );
  expect(result.repeats).toBe(10);
  expect(result.samples).toBe(552000);
  expect(result.maxError).toBeLessThan(0.000001);
  expect(result.firstSample).toBeCloseTo(0.12, 5);
});
test("author uploads, edits, previews and publishes without admin approval", /** @brief 投稿UIから実API・D1・R2・一般聴取までつなげて確認する。 */ async ({
  page,
}, info) => {
  await page.goto("/manage");
  await page.getByRole("button", { name: "composer-a", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "担当作品", exact: true }),
  ).toBeVisible();
  await page.locator(".manage-list a").first().click();
  const title = `E2E ${info.project.name} 検証曲`;
  await page.getByLabel("新しい曲名", { exact: true }).fill(title);
  await page.getByRole("button", { name: "曲を追加", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "クレジットを追加" }).click();
  await page.getByLabel("クレジット1の公開名").fill("検証用作成者");
  await page
    .getByLabel("音源（MP3")
    .setInputFiles({
      name: "demo.wav",
      mimeType: "audio/wav",
      buffer: toneWav(),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "音源を登録しました" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(
    page.getByLabel("この音源の区間ループを有効にする"),
  ).toBeEnabled();
  await page.getByLabel("この音源の区間ループを有効にする").check();
  await page.getByLabel("開始位置（秒）").fill("1");
  await page.getByLabel("終了位置（秒）").fill("3");
  await page
    .getByLabel("曲の代表画像")
    .setInputFiles({
      name: "demo.png",
      mimeType: "image/png",
      buffer: placeholderPng(200, 360),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "画像を登録しました" }).first(),
  ).toBeVisible();
  await page.getByLabel("代表画像の代替テキスト").fill("縦長のテスト画像");
  await page.getByLabel("音源・画像・クレジットの公開と").check();
  if (
    await page.evaluate(
      /** @brief 実ブラウザーのAPIがある場合だけ試聴成功を検証する。 */ () =>
        typeof AudioContext !== "undefined",
    )
  ) {
    await page.getByRole("button", { name: "つなぎ目を試聴" }).click();
    await expect(page.getByLabel("リピート", { exact: true })).toHaveValue(
      "region",
    );
  } else
    info.annotations.push({
      type: "unverified",
      description:
        "Windows WebKitはWeb Audio APIなし。登録・公開は確認し、区間試聴は実Safari確認待ち。",
    });
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "この曲を公開する", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "この曲を公開する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "更新を反映する", exact: true }),
  ).toBeVisible();
  const trackId = page.url().split("/").at(-1)!;
  const publicResult = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  expect(
    publicResult
      .flatMap(
        /** @brief 公開APIで投稿結果を確認する。 */ (game) => game.tracks,
      )
      .some(
        /** @brief 下書きだけの成功ではないことを検査する。 */ (track) =>
          track.id === trackId && track.title === title,
      ),
  ).toBe(true);
  await page.getByLabel("曲名", { exact: true }).fill(`${title} 未保存`);
  page.once(
    "dialog",
    /** @brief 未保存入力の破棄確認をキャンセルする。 */ (dialog) => {
      void dialog.dismiss();
    },
  );
  await page.getByRole("link", { name: "← 作品の編集" }).click();
  await expect(page.getByLabel("曲名", { exact: true })).toHaveValue(
    `${title} 未保存`,
  );
});
test("ad request failure does not block catalogue and playback controls", /** @brief 広告ブロック時の主要導線を検証する。 */ async ({
  page,
}) => {
  await page.route(
    "**/api/public/ad",
    /** @brief 広告サービスだけの通信失敗を再現する。 */ (route) =>
      route.abort(),
  );
  await page.goto("/");
  await expect(page.locator(".game-card").first()).toBeVisible();
  await page.locator(".game-card").first().click();
  await expect(
    page.getByRole("button", { name: "▶ OSTを再生", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".ad-slot")).toHaveCount(0);
});
