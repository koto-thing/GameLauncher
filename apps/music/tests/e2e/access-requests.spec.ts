import { test, expect } from "@playwright/test";

/** @brief 別ブラウザーの運営がMusic申請を承認し、本人が同じCookieで担当作品を開く */
test("Music applicant and administrator complete access approval without account IDs", async ({ page, browser }) => {
  const origin = "http://127.0.0.1:8788";
  const name = `申請確認 ${Date.now()}`;
  await page.goto(`${origin}/api/auth/dev?as=outsider`);
  await page.goto(`${origin}/access?service=music`);
  await expect(page.getByLabel("申請先")).toHaveValue("music");
  await page.getByLabel("氏名・活動名").fill(name);
  await page.getByLabel("担当したい作品名").fill("DEMO 2 / 夜の航路");
  await page.getByLabel("利用目的").fill("作品の楽曲を登録・公開します");
  await page.getByRole("button", { name: "利用を申請する", exact: true }).click();
  const request = page.locator("article").filter({ hasText: name });
  await expect(request.getByRole("heading")).toContainText("承認待ち");
  await expect(page.getByRole("button", { name: "申請を審査する", exact: true })).toHaveCount(0);

  const reviewer = await browser.newPage();
  try {
    await reviewer.goto(`${origin}/api/auth/dev?as=music-admin`);
    await reviewer.goto(`${origin}/access?service=music`);
    await reviewer.getByRole("button", { name: "申請を審査する", exact: true }).click();
    const review = reviewer.locator("article").filter({ hasText: name });
    await expect(review.getByRole("button", { name: "承認して権限を付与" })).toBeDisabled();
    await review.getByLabel("付与する作品").selectOption({ label: "DEMO 2 / 夜の航路" });
    await review.getByRole("button", { name: "承認して権限を付与" }).click();
    await expect(review.getByRole("heading")).toContainText("承認済み");

    await page.getByRole("button", { name: "状態を更新", exact: true }).click();
    await expect(request.getByRole("heading")).toContainText("承認済み");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("利用目的")).toBeVisible();
    await page.screenshot({ path: "build/access-mobile.png", fullPage: true });
    await request.getByRole("link", { name: "管理画面を開く" }).click();
    await expect(page.getByRole("link").filter({ hasText: "DEMO 2 / 夜の航路" })).toBeVisible();
  } finally {
    await reviewer.close();
  }
});

/** @brief ゲーム申請も本人入力からOwnerによる権限選択まで実UIで確定する */
test("game administrator chooses a grant from an applicant request", async ({ page, browser }) => {
  const origin = "http://127.0.0.1:8788";
  const name = `ゲーム申請 ${Date.now()}`;
  await page.goto(`${origin}/api/auth/dev?as=maintainer`);
  await page.goto(`${origin}/access`);
  await page.getByLabel("氏名・活動名").fill(name);
  await page.getByLabel("利用目的").fill("本番公開を担当します");
  await page.getByRole("button", { name: "利用を申請する", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: name })).toContainText("承認待ち");

  const reviewer = await browser.newPage();
  try {
    await reviewer.goto(`${origin}/api/auth/dev?as=admin`);
    await reviewer.goto(`${origin}/access`);
    await reviewer.getByRole("button", { name: "申請を審査する", exact: true }).click();
    const review = reviewer.locator("article").filter({ hasText: name });
    await review.getByLabel("付与する権限").selectOption("production_requester");
    await review.getByRole("button", { name: "承認して権限を付与" }).click();
    await expect(review).toContainText("付与した権限：本番申請者");
    await page.getByRole("button", { name: "状態を更新", exact: true }).click();
    const request = page.locator("article").filter({ hasText: name });
    await expect(request).toContainText("承認済み");
    await request.getByRole("link", { name: "管理画面を開く" }).click();
    await expect(page.getByRole("heading", { name: "Staging / Production 公開申請", exact: true })).toBeVisible();
  } finally {
    await reviewer.close();
  }
});
