import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import config from "../../site.config.ts";

/** Verify that all OS slots remain visible, equally sized and inside the viewport width. */
async function assertLayout(page: Page, stacked: boolean): Promise<void> {
  const boxes = await page.locator(".download").evaluateAll(elements => elements.map(el => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(boxes).toHaveLength(3);
  // Firefox can report identical grid tracks with a 0.00002px floating-point difference.
  // Keep the tolerance below one layout unit (1/60px), so visible size differences still fail.
  for (const dimension of ["width", "height"] as const) {
    const sizes = boxes.map(box => box[dimension]);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(0.01);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (stacked) expect(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y).toBe(true);
  else expect(new Set(boxes.map(box => box.y)).size).toBe(1);
  const center = await page.locator(".hero").boundingBox();
  expect(Math.abs(center!.x + center!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
}

for (const platform of ["windows", "linux"] as const) test(`initial HTML, ${platform} download click, disabled OS and no premature external requests`, async ({ page, browserName }) => {
  const external: string[] = [];
  page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1")) external.push(request.url()); });
  await page.goto("./");
  await expect(page).toHaveTitle("Play and Discover");
  await expect(page.locator('button[data-platform="macos"]')).toBeDisabled();
  await expect(page.locator('a[data-platform="linux"]')).toHaveAttribute("href", config.downloads.linux.url);
  if (config.background.videoUrl) await expect(page.locator("video")).toHaveClass(/has-frame/u);
  await expect(page.getByRole("button", { name: /背景動画/u })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("img", { name: "PandD" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("img", { name: "PandD" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toHaveText("© PandD");
  expect(external).toEqual([]);
  // Intercept only the click destination to avoid downloading a 33 MB executable during every test.
  await page.route(config.downloads[platform].url, route => route.fulfill({
    status: 200, contentType: "application/octet-stream",
    headers: { "content-disposition": 'attachment; filename="test-only.txt"' }, body: "local click verification",
  }));
  // Windows Playwright WebKit does not tab to links in its default keyboard mode.
  // Verify focus styling and keyboard activation there; native Tab order is checked in the other engines.
  if (browserName === "webkit" || platform === "linux") await page.locator(`a[data-platform="${platform}"]`).press("Shift");
  else {
    await page.keyboard.press("Tab");
    await expect(page.locator("#language")).toBeFocused();
    await page.keyboard.press("Tab");
  }
  await expect(page.locator(`a[data-platform="${platform}"]`)).toBeFocused();
  expect(await page.locator(`a[data-platform="${platform}"]`).evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  // WebKit on Windows does not expose a download event for a route-fulfilled attachment.
  // Its outbound URL is verified; Chromium and Firefox additionally verify the download event.
  const destination = browserName === "webkit"
    ? page.waitForRequest(config.downloads[platform].url)
    : page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await destination).url()).toBe(config.downloads[platform].url);
});

for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844], [320, 568], [667, 375]]) {
  test(`layout ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("./");
    await assertLayout(page, width < 768);
    if (width >= 1366) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      const hero = await page.locator(".hero").boundingBox();
      expect(Math.abs(hero!.y + hero!.height / 2 - height / 2)).toBeLessThan(2);
    }
    await page.screenshot({ path: `build/screenshots/${testInfo.project.name}-${width}x${height}.png`, fullPage: true });
  });
}

test("200% text size and short viewport preserve every operation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 683, height: 384 });
  await page.goto("cases/video");
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  await assertLayout(page, true);
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  const toggle = await page.locator(".site-footer").boundingBox();
  const downloads = await page.locator(".downloads").boundingBox();
  expect(toggle!.y).toBeGreaterThanOrEqual(downloads!.y + downloads!.height);
  await page.screenshot({ path: `build/screenshots/${testInfo.project.name}-text-200.png`, fullPage: true });
});

test("no JavaScript retains poster, title and usable static download", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const media: string[] = [];
  page.on("request", r => { if (r.url().includes("video.mp4")) media.push(r.url()); });
  await page.goto("http://127.0.0.1:5181/launcher/cases/video");
  await expect(page.getByRole("heading", { name: "Play and Discover", exact: true })).toBeVisible();
  for (const platform of ["windows", "linux"] as const) {
    await expect(page.locator(`a[data-platform="${platform}"]`)).toHaveAttribute("href", config.downloads[platform].url);
  }
  await expect(page.locator(".site-footer")).toBeVisible();
  expect(media).toEqual([]);
  await expect(page.locator(".poster")).toHaveCSS("background-image", /poster\.svg/u);
  await context.close();
});

test("missing all media still renders typography and OS slots", async ({ page }) => {
  await page.goto("cases/empty");
  await expect(page.locator(".wordmark")).toHaveText("PandD");
  await expect(page.locator(".backdrop")).toHaveCSS("background-color", "rgb(36, 34, 35)");
  await expect(page.locator(".site-footer")).toBeVisible();
  await assertLayout(page, false);
});

test("all available OS retain equal dimensions even when a detail wraps", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("cases/all-available");
  await expect(page.locator("a.download")).toHaveCount(3);
  await assertLayout(page, true);
});

test("200% mobile text keeps the footer below expanded content", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("cases/video");
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  await assertLayout(page, true);
  const downloads = await page.locator(".downloads").boundingBox();
  const toggle = await page.locator(".site-footer").boundingBox();
  expect(toggle!.y).toBeGreaterThanOrEqual(downloads!.y + downloads!.height);
  await page.screenshot({ path: `build/screenshots/${testInfo.project.name}-mobile-text-200.png`, fullPage: true });
});
