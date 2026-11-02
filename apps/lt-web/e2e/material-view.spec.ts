import { expect, test } from "@playwright/test";
import fixture from "../../../contracts/lt/application.fixture.json" with { type: "json" };

/**
 * 資料の表示と差し替え、全画面拒否時の案内を検証する
 * @param context ブラウザーページを持つテスト実行環境
 * @returns 検証の完了を表すPromise
 */
test("提出資料のビューと差し替えプレビューをPCとスマートフォンで表示する", async ({ page }) => {
  let application = {
    ...fixture,
    materialUrl: "https://docs.google.com/presentation/d/test_deck/edit",
    materialReviewed: true,
  };
  // 外部サービスへ架空資料を送らず、サイト側の表示と保存を検証する
  await page.route("https://docs.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Google slide fixture</p>" }),
  );
  await page.route("https://onedrive.live.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>PowerPoint fixture</p>" }),
  );
  await page.route("**/api/lt/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = application;
    if (path.endsWith("/events")) body = { items: [], nextCursor: null };
    else if (path.endsWith("/auth/session")) body = { expiresAt: "2030-01-01T00:00:00.000Z" };
    else if (path.endsWith("/applications")) body = { items: [application], nextCursor: null };
    else if (path.endsWith("/material")) {
      const input = request.postDataJSON();
      expect(input.expectedVersion).toBe(application.version);
      application = {
        ...application,
        materialUrl: input.data.materialUrl,
        materialReviewed: false,
        version: application.version + 1,
      };
      body = application;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/applications");
  await expect(page.getByTitle("Google スライドの発表資料")).toHaveAttribute(
    "src",
    "https://docs.google.com/presentation/d/test_deck/preview",
  );
  await page
    .getByLabel("資料URL", { exact: true })
    .fill("https://onedrive.live.com/embed?resid=AB12!345&authkey=!test");
  await expect(page.getByTitle("PowerPointの発表資料")).toBeVisible();
  await page.getByRole("button", { name: "資料を保存", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(page.getByText("運営の確認待ち", { exact: false })).toBeVisible();

  // モバイルでもビューが画面幅を超えず、全画面拒否時も操作を続けられる
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator("iframe").boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.evaluate(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("denied"));
  });
  await page.getByRole("button", { name: "スライドを全画面表示" }).click();
  await expect(page.getByText("この環境では全画面表示を開始できません。")).toBeVisible();
  await expect(page.getByRole("link", { name: "元の資料を開く" })).toHaveCount(0);
  expect(application.materialReviewed).toBe(false);
});
