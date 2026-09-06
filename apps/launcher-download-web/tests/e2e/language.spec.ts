import {test, expect} from "@playwright/test";
import {locales} from "../../src/locales.ts";
test("all five languages translate, persist and preserve downloads on mobile", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  // Translation assertions wait for the UI, independently of background video decoding.
  await page.goto("/launcher/", {waitUntil: "domcontentloaded"});
  const hrefs = await page.locator('a.download').evaluateAll(links => links.map(link => link.getAttribute('href')));
  for (const [code, text] of Object.entries(locales)) {
    await page.locator('#language').selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('.tagline')).toHaveText(text.tagline);
    await expect(page.locator('a.download .download-action')).toHaveText([text.download, text.download]);
    await expect(page.locator('[data-platform="macos"] .download-action')).toHaveText(text.soon);
    expect(await page.locator('a.download').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(hrefs);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('/launcher/', {waitUntil: "domcontentloaded"});
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await page.screenshot({path: 'build/screenshots/language-mobile.png'});
});

test("URL language overrides the saved language on desktop", async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('pandd-language', 'es'));
  await page.setViewportSize({width:1366,height:768});
  await page.goto('/launcher/?lang=en', {waitUntil: "domcontentloaded"});
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.screenshot({path:'build/screenshots/language-desktop.png'});
});
test("blocked storage and invalid language do not break switching", async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', {get() {throw new Error('blocked');}}); });
  await page.goto('/launcher/?lang=invalid');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.locator('#language').selectOption('ko');
  await expect(page.locator('html')).toHaveAttribute('lang','ko');
});

for (const [language, expected] of [["ja-JP", "ja"], ["en-US", "en"], ["ko-KR", "ko"], ["zh-CN", "zh-CN"], ["es-MX", "es"], ["de-DE", "en"]]) {
  test(`browser language ${language} selects ${expected}`, async ({browser}) => {
    const context = await browser.newContext({locale: language});
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5181/launcher/");
    await expect(page.locator("html")).toHaveAttribute("lang", expected);
    await expect(page.locator("#language")).toHaveValue(expected);
    await context.close();
  });
}

test("uses the first supported preferred language", async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", {value: ["de-DE", "es-MX", "ja-JP"]}));
  await page.goto("/launcher/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});
