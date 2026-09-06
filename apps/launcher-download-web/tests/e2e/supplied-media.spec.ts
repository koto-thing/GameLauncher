import { test, expect } from "@playwright/test";

test("supplied three-clip background decodes all scenes and loops without playback controls", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("./");
  const video = page.locator("video");
  await expect(video).toHaveClass(/has-frame/u);
  const metadata = await video.evaluate((el: HTMLVideoElement) => ({
    duration: el.duration, width: el.videoWidth, height: el.videoHeight, muted: el.muted,
  }));
  expect(metadata).toMatchObject({ duration: 30, muted: true });
  // Windows WebKit may report presentation dimensions here; encoding dimensions are checked with ffprobe.
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /背景動画/u })).toHaveCount(0);
  for (const second of [2, 12, 22]) {
    await video.evaluate((el: HTMLVideoElement, time) => new Promise<void>(resolve => {
      el.addEventListener("seeked", () => resolve(), { once: true });
      el.currentTime = time;
    }), second);
    await page.screenshot({ path: `build/screenshots/${info.project.name}-supplied-${second}s.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `build/screenshots/${info.project.name}-supplied-mobile.png`, fullPage: true });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(22);
  await video.evaluate((el: HTMLVideoElement) => { el.currentTime = 29.8; });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeLessThan(1);
  expect(errors).toEqual([]);
});
