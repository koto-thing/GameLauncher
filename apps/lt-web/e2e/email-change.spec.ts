import { test, expect } from "@playwright/test";
for (const width of [1280, 390])
  test(`メール変更確認 ${width}px GET非消費・連打・戻る・再読込`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let posts = 0;
    await page.route("**/api/lt/v1/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: route.request().url().endsWith("/session") ? null : { items: [], nextCursor: null },
        });
        return;
      }
      expect(route.request().url()).toContain("/auth/email-change/verify");
      expect(route.request().headers()["x-lt-csrf"]).toBe("1");
      posts++;
      await route.fulfill({ json: { accepted: true } });
    });
    await page.goto("/auth/email-change?token=fixture-only");
    await expect(page.getByRole("heading", { name: "新しいメールアドレスの確認" })).toBeVisible();
    expect(posts).toBe(0);
    expect(page.url()).not.toContain("token");
    await page.getByRole("button", { name: "メールアドレスを確認する" }).click({ clickCount: 2 });
    await expect(page.getByRole("status")).toContainText("最終確定");
    expect(posts).toBe(1);
    expect(await page.context().cookies()).toHaveLength(0);
    await page.screenshot({ path: `qa/email-change-${width}.png`, fullPage: true });
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("確認リンクがありません");
    expect(posts).toBe(1);
    await page.goto("/");
    await page.goBack();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(posts).toBe(1);
  });
for (const status of [400, 410, 503])
  test(`無効/期限切れ/通信結果不明 ${status}`, async ({ page }) => {
    let count = 0;
    await page.route("**/api/lt/v1/**", async (route) => {
      count++;
      await route.fulfill({
        status,
        json: { error: { code: "TOKEN_INVALID", requestId: "fixture" } },
      });
    });
    await page.goto("/auth/email-change?token=fixture-invalid");
    await page.getByRole("button", { name: "メールアドレスを確認する" }).click();
    await expect(page.getByRole("alert")).toContainText("確認結果を取得できません");
    expect(count).toBe(1);
    await expect(page.getByRole("button", { name: "メールアドレスを確認する" })).toHaveCount(0);
  });
