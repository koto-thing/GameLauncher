import { test, expect } from "@playwright/test";

test("theme follows initial system preference and persists a manual choice across pages", /** @brief 端末設定・手動選択・画面遷移・再読込を通して実際の配色を確認する。 */ async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(25, 23, 25)",
  );
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        /** @brief 切替ボタン追加でナビゲーションが横に溢れないことを確認する。 */ () =>
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "ライトモードに切り替える" }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `build/theme-dark-${info.project.name}-390.png`,
    fullPage: true,
  });
  const toggle = page.getByRole("button", { name: "ライトモードに切り替える" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(250, 247, 248)",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator(".game-card").first().click();
  await page.locator(".track-list a").first().click();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.locator(".mini-player")).toBeVisible();
  const currentTrack = await page.locator(".mini-info").getAttribute("href");
  await page.getByRole("button", { name: "ダークモードに切り替える" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".mini-info")).toHaveAttribute(
    "href",
    currentTrack!,
  );
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:8788/api/auth/dev?as=music-a");
  await page.goto("http://127.0.0.1:8788/music#/manage");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator(".manage-list a").filter({ hasText: "DEMO 1 /" }).click();
  await expect(page.getByLabel("作品名", { exact: true })).toHaveCSS(
    "background-color",
    "rgb(37, 34, 37)",
  );
  await expect(page.getByLabel("作品名", { exact: true })).toHaveCSS(
    "color",
    "rgb(244, 237, 240)",
  );
});

test("theme can switch when browser storage is blocked", /** @brief 保存拒否を未処理エラーにせず現在画面の切替を提供する。 */ async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(
    /** @brief ブラウザーのストレージ利用拒否を再現する。 */ () => {
      Object.defineProperty(window, "localStorage", {
        get: /** @brief 読取と書込の両方でSecurityErrorを返す。 */ () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      });
    },
  );
  const errors: string[] = [];
  page.on(
    "pageerror",
    /** @brief 設定保存の失敗がページ全体へ伝播しないことを調べる。 */ (
      error,
    ) => errors.push(error.message),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "ダークモードに切り替える" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "ライトモードに切り替える" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});
