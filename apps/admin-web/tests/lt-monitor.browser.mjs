import { chromium } from "../../lt-web/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.permissionRequests = 0;
    Object.defineProperty(Notification, "requestPermission", { value: async () => { window.permissionRequests++; return "granted"; } });
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: "B".repeat(87), auth: "B".repeat(22) }, unsubscribe: async () => true };
    const registration = { active: true, pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } };
    Object.defineProperty(navigator.serviceWorker, "register", { value: async () => registration });
    Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => registration });
  });
  await page.goto("http://127.0.0.1:24579/");
  await page.getByRole("heading", { name: "自動運営と通知" }).waitFor();
  await page.getByText("定期処理：実行未確認・5分以上の遅延").waitFor();
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.getByRole("button", { name: "このブラウザーで通知を有効にする" }).click();
  await page.getByText("受信設定：有効", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.permissionRequests), 1);
  await page.getByRole("button", { name: "自分の全端末で通知を停止" }).click();
  await page.getByText("受信設定：無効", { exact: false }).waitFor();
  await page.getByRole("button", { name: "架空LT会：辞退依頼の確認" }).click();
  await page.getByRole("heading", { name: "架空発表", exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.deepEqual(errors, []);
  console.log("Operations monitor browser: opt-in only, opt-out, action navigation, desktop/mobile PASS");
} finally { await browser.close(); }
