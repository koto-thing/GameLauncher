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
    await expect(page.locator(".sub-nav a")).toHaveCount(4);
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.locator(".feature")).toHaveCount(4);
    expect(await page.locator(".brand-title").evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      width === 390 ? "16px" : "18px",
    );
    expect(
      await page.locator(".brand-logo").evaluate((el) => el.getBoundingClientRect().width),
    ).toBe(120);
    await expect(page.locator(".brand-logo")).toHaveAttribute("src", "/pandd-logo.png");
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/pandd-logo.png");
    if (width === 1280)
      expect(await page.locator(".hero").evaluate((el) => el.getBoundingClientRect().width)).toBe(
        1160,
      );
    await expect(page.locator(".talk-card")).toHaveCount(1);
    await expect(page.locator(".apply-panel button")).toBeDisabled();
    expect(
      await page
        .locator(".btn.coral")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(255, 96, 123)");
    const facts = await page
      .locator(".feature-strip")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(facts).toBe(width === 390 ? 2 : 4);
    const columns = await page
      .locator(".content-row")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width === 390 ? 1 : 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/readonly-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: event.title, exact: true }).click();
    await page
      .locator(".hero-buttons")
      .getByRole("link", { name: "タイムテーブル", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "タイムテーブル", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "発表詳細", exact: true }).click();
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

for (const width of [1280, 390]) {
  test(`モック準拠の空状態 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const unexpected: string[] = [];
    await page.route("**/api/lt/v1/**", async (route) => {
      if (
        new URL(route.request().url()).pathname !== "/api/lt/v1/events" ||
        route.request().method() !== "GET"
      )
        unexpected.push(route.request().url());
      await route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "公開中の開催回はありません" })).toBeVisible();
    await expect(page.locator(".brand-title")).toHaveText("Aizu LT");
    await expect(page.locator(".sub-nav a")).toHaveCount(4);
    await expect(page.locator(".public-empty")).toBeVisible();
    await expect(page.locator(".hero")).toHaveCount(0);
    await expect(page.locator(".talk-card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "初期化" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "一般向けサイト" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/empty-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "参加・お問い合わせ", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "参加・お問い合わせ", exact: true }),
    ).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    expect(unexpected).toEqual([]);
  });
}
