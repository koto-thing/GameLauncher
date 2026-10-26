import { test, expect } from "@playwright/test";
import type { PublicEvent, PublicTalk } from "../../../contracts/lt/v1";

const event: PublicEvent = {
  id: "readonly-fixture",
  version: 1,
  title: "架空の開催回",
  venue: "架空会場",
  guidance: "",
  startsAt: "2030-01-01T03:00:00.000Z",
  endsAt: "2030-01-01T04:00:00.000Z",
  timeZone: "Asia/Tokyo",
  recruitment: "open",
  schedule: [
    {
      id: "block",
      kind: "talk",
      talkId: "talk",
      startsAt: "2030-01-01T03:00:00.000Z",
      endsAt: "2030-01-01T03:10:00.000Z",
    },
  ],
};
const talk: PublicTalk = {
  id: "talk",
  eventId: event.id,
  version: 1,
  title: "架空の発表",
  abstract: "承認済みの公開概要",
  speakers: [{ displayName: "架空の登壇者" }],
  startsAt: "2030-01-01T03:00:00.000Z",
  endsAt: "2030-01-01T03:10:00.000Z",
  cancelled: false,
};

for (const width of [1280, 390]) {
  test(`閲覧専用 ${width}px: 公開ページと停止中の直接URL`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const forbidden: string[] = [];
    await page.route("**/api/lt/v1/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname.replace("/api/lt/v1", "");
      const value =
        path === "/events"
          ? { items: [event], nextCursor: null }
          : path === `/events/${event.id}`
            ? event
            : path === `/events/${event.id}/talks/${talk.id}`
              ? talk
              : null;
      if (req.method() !== "GET" || value === null) forbidden.push(`${req.method()} ${path}`);
      await route.fulfill({
        status: value === null ? 501 : 200,
        contentType: "application/json",
        body: JSON.stringify(value ?? { error: { code: "NOT_IMPLEMENTED", requestId: "fixture" } }),
      });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "架空の開催回" })).toBeVisible();
    await expect(
      page.getByText("登壇申請・メール確認は現在利用できません。", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "本人申請", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `test-results/readonly-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: event.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: "時間割", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "発表詳細", exact: true }).click();
    await expect(page.getByRole("heading", { name: talk.title, exact: true })).toBeVisible();
    await expect(page.getByText(talk.abstract, { exact: true })).toBeVisible();
    for (const path of [
      "/login",
      "/apply",
      "/applications",
      "/applications/new",
      `/events/${event.id}/apply`,
      "/auth/verify?token=fixture",
      "/auth/email-change?token=fixture",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "現在利用できません", exact: true }),
      ).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.locator('input[type="email"]')).toHaveCount(0);
      if (path.startsWith("/auth/")) expect(new URL(page.url()).search).toBe("");
    }
    expect(forbidden).toEqual([]);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });
}
