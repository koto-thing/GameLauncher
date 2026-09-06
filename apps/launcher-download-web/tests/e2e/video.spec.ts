import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Query real decoder state instead of inferring success from a button label. */
const mediaState = (page: Page) => page.locator("video").evaluate((video: HTMLVideoElement) => ({
  paused: video.paused, time: video.currentTime, muted: video.muted,
  loop: video.loop, inline: video.hasAttribute("playsinline"), ready: video.readyState,
}));

test("real MP4 autoplay and loop", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("cases/video");
  await expect(page.locator("video")).toHaveClass(/has-frame/u);
  await expect.poll(async () => (await mediaState(page)).time).toBeGreaterThan(0.1);
  expect(await mediaState(page)).toMatchObject({ paused: false, muted: true, loop: true, inline: true });
  await page.locator("video").evaluate((video: HTMLVideoElement) => { video.currentTime = video.duration - 0.15; });
  await expect.poll(async () => (await mediaState(page)).time).toBeLessThan(1);
  expect(errors).toEqual([]);
  // The authored test video is white: this is a deliberately bright contrast check, not product artwork.
  await page.locator("a.download").press("Shift");
  await expect(page.locator("a.download")).toBeFocused();
  await page.screenshot({ path: `build/screenshots/${testInfo.project.name}-bright-video-focus.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `build/screenshots/${testInfo.project.name}-bright-video-mobile.png`, fullPage: true });
});

test("reduced motion fetches no video and stops playback on preference changes", async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests: string[] = [];
  page.on("request", r => { if (r.url().includes("video.mp4")) requests.push(r.url()); });
  await page.goto(`cases/reduced?run=${browserName}`);
  await expect(page.getByRole("button", { name: /背景動画/u })).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(requests).toEqual([]);
  // WebKit can load media outside Playwright's page request interception; count real HTTP requests too.
  const count = async () => (await page.request.get(`fixtures/requests?case=reduced&run=${browserName}`)).json();
  expect(await count()).toBe(0);
  expect(await page.locator("video").getAttribute("src")).toBeNull();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("cases/video");
  await expect(page.locator("video")).toHaveClass(/has-frame/u);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await mediaState(page)).paused).toBe(true);
  await expect(page.locator("video")).not.toHaveClass(/has-frame/u);
});

test("autoplay denial keeps poster without playback controls", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      if (first) { first = false; return Promise.reject(new DOMException("test policy denial", "NotAllowedError")); }
      return original.call(this);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("cases/video");
  await expect(page.getByRole("button", { name: /背景動画/u })).toHaveCount(0);
  await expect(page.locator("video")).not.toHaveClass(/has-frame/u);
  await expect(page.locator(".poster")).toHaveCSS("background-image", /poster\.svg/u);
  expect(errors).toEqual([]);
});

for (const failure of ["404", "network", "unsupported", "both-missing"]) {
  test(`media failure: ${failure}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`cases/${failure}`);
    await expect(page.locator(".video-toggle")).toBeHidden();
    await expect(page.locator("video")).not.toHaveClass(/has-frame/u);
    await expect(page.locator("a.download")).toBeVisible();
    await expect(page.locator(".backdrop")).toHaveCSS("background-color", "rgb(36, 34, 35)");
    expect(errors).toEqual([]);
  });
}

test("pending media does not hold up downloads and reduced motion cancels late playback", async ({ page }) => {
  try {
    await page.goto("cases/pending", { waitUntil: "domcontentloaded" });
    await expect(page.locator("a.download")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  } finally {
    await page.request.get("fixtures/release-pending");
  }
  await expect.poll(async () => (await mediaState(page)).paused).toBe(true);
  await page.waitForTimeout(200);
  expect((await mediaState(page)).paused).toBe(true);
});

test("visibility resumes only previously playing video; reduced motion survives return", async ({ page }) => {
  await page.goto("cases/video");
  await expect(page.locator("video")).toHaveClass(/has-frame/u);
  // Headless engines vary in tab activation; exercise the actual Page Visibility event deterministically.
  const visibility = async (hidden: boolean) => page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await visibility(true);
  expect((await mediaState(page)).paused).toBe(true);
  await visibility(false);
  await expect.poll(async () => (await mediaState(page)).paused).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await mediaState(page)).paused).toBe(true);
  await visibility(true);
  await visibility(false);
  expect((await mediaState(page)).paused).toBe(true);
});
