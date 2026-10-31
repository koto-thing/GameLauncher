import { expect, test } from "@playwright/test";
import fixture from "../../../contracts/lt/application.fixture.json" with { type: "json" };

test("承認済み申請のタイトルを一覧と詳細から変更する", async ({ page }) => {
  let application = { ...fixture, review: "approved" };
  const mutations: unknown[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  // 通信だけを置き換え、画面から送られる版とタイトルを検証する
  await page.route("**/api/lt/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = application;
    if (path.endsWith("/events")) body = { items: [], nextCursor: null };
    else if (path.endsWith("/auth/session")) body = { expiresAt: "2030-01-01T00:00:00.000Z" };
    else if (path.endsWith("/applications")) body = { items: [application], nextCursor: null };
    else if (path.endsWith("/title")) {
      const input = request.postDataJSON();
      mutations.push(input);
      expect(request.method()).toBe("POST");
      expect(input.expectedVersion).toBe(application.version);
      expect(input.operationId).toBeTruthy();
      expect(Object.keys(input.data)).toEqual(["title"]);
      application = {
        ...application,
        version: application.version + 1,
        content: { ...application.content, title: input.data.title },
        published: { ...application.published, title: input.data.title },
      };
      body = application;
    }
    await route.fulfill({ json: body });
  });

  await page.goto("/applications");
  await page.getByLabel("発表タイトル", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "タイトルを保存" }).click();
  expect(mutations).toHaveLength(0);
  await page.getByLabel("発表タイトル", { exact: true }).fill("一覧から変更");
  await page.getByRole("button", { name: "タイトルを保存" }).click();
  await expect(page.getByRole("heading", { name: "一覧から変更" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("発表タイトル", { exact: true })).toHaveValue("一覧から変更");

  await page.goto(`/applications/${application.id}`);
  await page.getByLabel("発表タイトル", { exact: true }).fill("詳細から変更");
  await page.getByRole("button", { name: "タイトルを保存" }).click();
  await expect(page.getByRole("heading", { name: "詳細から変更" })).toBeVisible();
  expect(mutations).toHaveLength(2);
  expect(application.review).toBe("approved");
  expect(errors).toEqual([]);
});
