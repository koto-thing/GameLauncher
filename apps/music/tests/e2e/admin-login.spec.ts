import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:8788";

test("shared login returns to the requested management page", /** @brief 匿名アクセスから共通ログインと元画面への復帰を実ブラウザーで検証する */ async ({ page }) => {
  await page.goto(`${origin}/game`);
  await expect(page).toHaveURL(`${origin}/login?returnTo=%2Fgame`);
  await expect(page.getByText("ログインは6時間有効です。認証後は元の管理画面へ戻ります。")).toBeVisible();
  await page.getByRole("link", { name: "Adminとして確認", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/game`);
  await expect(page.getByRole("heading", { name: "公開申請", level: 1 })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(/** @brief 画面全体の横はみ出しを検出する */ () => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/login?returnTo=%2Fgame`);
});

test("an expired session redirects when the window regains focus", /** @brief 表示中に認証が失効した場合も共通入口へ戻す */ async ({ page }) => {
  await page.goto(`${origin}/api/auth/dev?as=admin&returnTo=%2Fgame`);
  await expect(page.getByRole("heading", { name: "公開申請", level: 1 })).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(/** @brief タブ復帰時の確認を実行する */ () => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(`${origin}/login?returnTo=%2Fgame`);
});
