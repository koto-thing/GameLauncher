import { test, expect, type Page } from "@playwright/test";
import type { Application, PublicEvent } from "../../../contracts/lt/v1";
const event: PublicEvent = {
  id: "qa-event",
  version: 1,
  title: "QA 架空開催回",
  venue: "架空会場",
  guidance: "",
  startsAt: "2030-01-01T15:00:00.000Z",
  endsAt: "2030-01-01T16:00:00.000Z",
  timeZone: "Asia/Tokyo",
  recruitment: "open",
  schedule: [],
};
// テスト context の route だけで状態を保持し、本番へ送信しない
async function adapter(page: Page) {
  let applications: Application[] = ["returned", "approved"].map((review) => ({
    id: `qa-${review}`,
    eventId: event.id,
    version: 1,
    content: {
      title: `架空 ${review}`,
      abstract: "概要",
      speakers: [{ displayName: "架空甲", affiliation: "架空所属", profile: "紹介" }],
    },
    materialUrl: "https://example.invalid/slides",
    representativeEmail: "qa@example.invalid",
    review: review as Application["review"],
    withdrawal: "none",
    firstSubmittedAt: "2026-10-25T00:00:00.000Z",
    everApproved: true,
    slotReserved: true,
    retentionExpiresAt: null,
    eventState: "scheduled",
    eventCancelledAt: null,
    published: null,
  }));
  const receipts = new Map<string, unknown>();
  let posts = 0;
  await page.route("**/api/lt/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace("/api/lt/v1", "");
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/events") return send({ items: [event], nextCursor: null });
    if (path === `/events/${event.id}`) return send(event);
    if (path === "/auth/session") return send({ expiresAt: "2030-01-01T00:00:00.000Z" });
    if (path === "/applications" && req.method() === "GET")
      return send({ items: applications, nextCursor: null });
    if (req.method() === "GET") {
      const scenario = path.split("/").at(-1);
      if (["expired", "401", "409", "503"].includes(scenario!))
        return send(
          {
            error: {
              code:
                scenario === "expired"
                  ? "RETENTION_EXPIRED"
                  : scenario === "401"
                    ? "UNAUTHENTICATED"
                    : scenario === "409"
                      ? "VERSION_CONFLICT"
                      : "UNAVAILABLE",
              requestId: "qa",
            },
          },
          scenario === "expired" ? 410 : Number(scenario),
        );
      return send(applications.find((a) => path.endsWith(a.id)));
    }
    const input = req.postDataJSON();
    if (receipts.has(input.operationId)) return send(receipts.get(input.operationId));
    posts++;
    if (path === "/applications") {
      const a: Application = {
        ...applications[0],
        ...input,
        id: "qa-new",
        version: 1,
        review: "pending",
        everApproved: false,
        slotReserved: false,
      };
      applications.push(a);
      receipts.set(input.operationId, a);
      return send(a);
    }
    const a = applications.find((a) => path.includes(a.id));
    if (!a) return send(null, 404);
    if (a.version !== input.expectedVersion)
      return send({ error: { code: "VERSION_CONFLICT", requestId: "qa" } }, 409);
    if (req.method() === "PATCH") Object.assign(a, input.data);
    else if (path.endsWith("/resubmit")) a.review = "resubmitted";
    else if (path.endsWith("/request-withdrawal")) a.withdrawal = "requested";
    else if (path.endsWith("/cancel-withdrawal")) a.withdrawal = "none";
    a.version++;
    receipts.set(input.operationId, { ...a });
    return send(a);
  });
  return {
    get applications() {
      return applications;
    },
    get posts() {
      return posts;
    },
  };
}
test("PC: 申請、複数発表者、編集、再読込、戻る", async ({ page }) => {
  const state = await adapter(page);
  await page.goto("/applications/new");
  await page.getByLabel("開催回").selectOption("qa-event");
  await page.getByLabel("タイトル").fill("QA 新規申請");
  await page.getByLabel("概要", { exact: true }).fill("架空の概要");
  await page.getByLabel("名前", { exact: true }).fill("架空甲");
  await page.getByRole("button", { name: "発表者を追加" }).click();
  await page.getByLabel("名前", { exact: true }).nth(1).fill("架空乙");
  await page.getByLabel("資料URL").fill("https://example.invalid/qa");
  await page.getByRole("combobox", { name: "分野 ＊", exact: true }).selectOption("programming");
  await page.getByRole("combobox", { name: "難易度 ＊", exact: true }).selectOption("normal");
  await expect(page.getByRole("button", { name: "申請する", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "プライバシーポリシーを確認し、同意します" }).check();
  await page.getByRole("button", { name: "申請する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "本人申請", exact: true })).toBeVisible();
  expect(state.applications.filter((a) => a.id === "qa-new")).toHaveLength(1);
  const card = page.locator("article").filter({ hasText: "QA 新規申請" });
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await expect(page.getByLabel("名前", { exact: true }).nth(1)).toHaveValue("架空乙");
  await page.getByLabel("タイトル").fill("QA 編集済み");
  await page.getByRole("checkbox", { name: "プライバシーポリシーを確認し、同意します" }).check();
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "QA 編集済み" })).toBeVisible();
  await page.getByRole("button", { name: "開催回", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "本人申請", exact: true })).toBeVisible();
  await page.screenshot({ path: "qa/desktop.png", fullPage: true });
});
test("390px: 再提出、辞退取消、キーボード", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await adapter(page);
  await page.goto("/applications");
  await page
    .locator("article")
    .filter({ hasText: "架空 returned" })
    .getByRole("button", { name: "再提出", exact: true })
    .press("Enter");
  await expect(page.getByText("resubmitted / none")).toBeVisible();
  const card = page.locator("article").filter({ hasText: "架空 approved" });
  await card.getByRole("button", { name: "辞退依頼", exact: true }).click();
  await card.getByRole("button", { name: "辞退依頼を取消" }).click();
  await expect(card.getByText("approved / none")).toBeVisible();
  await page.screenshot({ path: "qa/mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("期限切れ・401・409・503 はエラー表示", async ({ page }) => {
  await adapter(page);
  for (const scenario of ["expired", "401", "409", "503"]) {
    await page.goto(`/applications/${scenario}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "再読み込み" })).toBeVisible();
  }
});

test("現在の親開催中止を再取得して変更操作を停止", async ({ page }) => {
  const state = await adapter(page);
  await page.goto("/applications");
  await expect(page.getByRole("button", { name: "辞退依頼", exact: true })).toHaveCount(2);
  for (const a of state.applications) {
    a.eventState = "cancelled";
    a.eventCancelledAt = "2026-10-25T09:00:00.000Z";
  }
  await page.reload();
  await expect(page.getByText("この開催回は中止されました")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "辞退依頼", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "編集", exact: true })).toHaveCount(0);
  await page.goto("/applications/qa-approved");
  await expect(page.getByText("この開催回は中止されました")).toBeVisible();
});
