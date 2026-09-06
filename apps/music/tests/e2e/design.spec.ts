import { test, expect } from "@playwright/test";
import { placeholderPng } from "../support/fixtures.mjs";
import type { PublicGame } from "../../src/domain/models";

test("admin hands page access by ID and author previews and publishes a game background", /** @brief 管理者の権限付与から担当者の背景公開までを実UIと匿名APIで確認する。 */ async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:8788/api/auth/dev?as=music-admin");
  await page.goto("http://127.0.0.1:8788/music#/manage");
  const title = `背景検証 ${info.project.name} ${Date.now()}`;
  await page.getByLabel("新しい作品名").fill(title);
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page.getByLabel("担当者のGitHub数値ID").fill("900002");
  await page
    .getByRole("button", { name: "編集権限を付与", exact: true })
    .click();
  await expect(
    page
      .locator(".account-list li")
      .filter({ hasText: "900002" })
      .getByRole("button"),
  ).toHaveText("担当を解除");
  const id = page.url().split("/").at(-1)!;
  await page.goto("http://127.0.0.1:8788/music#/manage");
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByRole("link", { name: "music-a", exact: true })).toBeVisible();
  await page.goto("http://127.0.0.1:8788/api/auth/dev?as=music-a");
  await page.goto("http://127.0.0.1:8788/music#/manage");
  await page.locator(".manage-list a").filter({ hasText: title }).click();
  await expect(page.getByLabel("担当者のGitHub数値ID")).toHaveCount(0);
  await page.getByLabel("背景色", { exact: true }).fill("#344466");
  await page.getByLabel("背景画像（任意").setInputFiles({
    name: "background.png",
    mimeType: "image/png",
    buffer: placeholderPng(),
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "背景画像を登録しました" })
      .first(),
  ).toBeVisible();
  await page.getByLabel("背景画像の表示方法").selectOption("tile");
  await page
    .getByLabel("画像・文章の公開と広告付きサイトでの利用を確認しました")
    .check();
  await expect(page.locator(".game-surface")).toHaveCSS(
    "background-color",
    "rgb(52, 68, 102)",
  );
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "作品を公開", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "作品を公開", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "作品の更新を反映", exact: true }),
  ).toBeEnabled();
  await page.goto(`/games/${id}`);
  await expect(page.locator(".game-surface")).toHaveCSS(
    "background-color",
    "rgb(52, 68, 102)",
  );
  await expect(page.locator(".background-tile")).toHaveCSS(
    "background-repeat",
    "repeat",
  );
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        /** @brief 背景の余白追加でスマホ横溢れを起こさない。 */ () =>
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `build/game-design-${info.project.name}-390.png`,
    fullPage: true,
  });
  const catalogue = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  expect(
    catalogue.find(
      /** @brief 公開版の保存内容をUIと照合する。 */ (game) => game.id === id,
    )?.design?.backgroundColor,
  ).toBe("#344466");
  // 他のE2Eが共有デモ件数へ依存するため、検証で公開した作品だけを取り下げる。
  await page.goto(`http://127.0.0.1:8788/music#/manage/games/${id}`);
  await page
    .getByRole("button", { name: "作品を非公開にする", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "作品を公開", exact: true }),
  ).toBeEnabled();
});
