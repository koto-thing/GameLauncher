import { test, expect } from "@playwright/test";
import type { PublicGame } from "../../src/domain/models";

test("hero cycles soundtrack artwork and permits pausing and manual navigation", /** @brief 実ブラウザーで時間経過・操作中停止・作品リンク・スマホ配置を検証する。 */ async ({
  page,
}, info) => {
  await page.clock.install();
  await page.goto("/");
  const slide = page.locator(".soundtrack-slide");
  await expect(slide).toBeVisible();
  const first = await slide.getAttribute("href");
  await page.clock.runFor(5100);
  await expect(slide).not.toHaveAttribute("href", first!);
  await page.clock.runFor(5100);
  await expect(slide).toHaveAttribute("href", first!);
  await page.getByRole("button", { name: "自動切り替えを停止" }).click();
  await page.locator(".brand").focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(10000);
  await expect(slide).toHaveAttribute("href", first!);
  await page.getByRole("button", { name: "次のサントラ画像" }).click();
  await expect(slide).not.toHaveAttribute("href", first!);
  await page.getByRole("button", { name: "自動切り替えを再開" }).click();
  const focused = await slide.getAttribute("href");
  await slide.focus();
  await page.clock.runFor(10000);
  await expect(slide).toHaveAttribute("href", focused!);
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        /** @brief 画像枠を追加しても画面が横へ溢れないことを確認する。 */ () =>
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.runFor(500);
  await page.screenshot({
    path: `build/carousel-${info.project.name}-desktop.png`,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `build/carousel-${info.project.name}-390.png`,
    fullPage: true,
  });
  await slide.click();
  await expect(page).toHaveURL(new RegExp(`${focused}$`));
  await expect(page.locator(".mini-player")).toHaveCount(0);
});

test("reduced motion and zero or single soundtrack do not auto rotate", /** @brief 省動作設定と作品数の境界で不要なタイマー・操作を作らない。 */ async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  const games = (await (
    await page.request.get("/api/public/catalogue")
  ).json()) as PublicGame[];
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "自動切り替えを再開" }),
  ).toBeVisible();
  const first = await page.locator(".soundtrack-slide").getAttribute("href");
  await page.clock.runFor(11000);
  await expect(page.locator(".soundtrack-slide")).toHaveAttribute(
    "href",
    first!,
  );
  await page.route(
    "**/api/public/catalogue",
    /** @brief 公開作品が1つだけの場合を再現する。 */ async (route) => {
      await route.fulfill({ json: [games[0]] });
    },
  );
  await page.reload();
  await expect(page.locator(".soundtrack-slide")).toBeVisible();
  await expect(page.locator(".carousel-controls")).toHaveCount(0);
  await page.unroute("**/api/public/catalogue");
  await page.route(
    "**/api/public/catalogue",
    /** @brief 公開前の空のライブラリを再現する。 */ async (route) => {
      await route.fulfill({ json: [] });
    },
  );
  await page.reload();
  await expect(page.locator(".soundtrack-carousel")).toHaveCount(0);
});
