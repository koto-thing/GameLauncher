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
  await page.getByRole("heading", { name: "自動運営", exact: true }).waitFor();
  await page.getByText("遅延・未確認").waitFor();
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.getByRole("button", { name: "このブラウザーで受け取る" }).click();
  await page.getByText("オン", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.permissionRequests), 1);
  await page.getByRole("button", { name: "全端末で停止" }).click();
  await page.getByText("オフ", { exact: true }).waitFor();
  await page.getByRole("button", { name: "架空LT会 辞退依頼の確認" }).click();
  await page.getByRole("heading", { name: "架空発表", exact: true }).waitFor();
  await page.getByRole("button", { name: "申請一覧に戻る" }).click();
  await page.getByRole("heading", { name: "申請一覧", exact: true }).waitFor();
  const navigation = page.getByRole("navigation", { name: "LT管理メニュー" });
  for (const [label, heading, id] of [["概要", "要対応", "overview"], ["登壇申請", "申請一覧", "applications"], ["タイムテーブル", "タイムテーブル編集", "timetable"], ["開催回設定", "開催回の設定", "settings"], ["例外対応", "例外対応・手動処理", "exceptions"]]) {
    await navigation.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await navigation.getByRole("button", { name: label, exact: true }).getAttribute("aria-current"), "page");
    for (const panel of ["applications", "timetable", "settings", "exceptions"]) assert.equal(await page.locator(`#lt-${panel}`).isVisible(), panel === id);
    assert.equal(await page.locator("#lt-monitor").isVisible(), false);
  }
  // 画面切り替え後も入力途中の開催設定を保持する
  await navigation.getByRole("button", { name: "開催回設定", exact: true }).click();
  const title = page.locator("#lt-settings input").first();
  await title.fill("編集中の開催回");
  await navigation.getByRole("button", { name: "概要", exact: true }).click();
  await navigation.getByRole("button", { name: "開催回設定", exact: true }).click();
  assert.equal(await title.inputValue(), "編集中の開催回");
  await navigation.getByRole("button", { name: "開催回一覧", exact: true }).click();
  await page.getByText("遅延・未確認", { exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `.wrangler/lt-ui-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.equal(await page.getByText("稼働の詳細", { exact: true }).count(), 0);
  assert.equal(await page.getByText("通知の詳細", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("要確認", { exact: true }).count(), 1);
  // 設定と時刻固定のチェックボックスが本文を押し潰さないことを確認する
  await page.getByRole("button", { name: "架空LT会 開催予定", exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await navigation.getByRole("button", { name: "開催回設定", exact: true }).click();
    await page.getByLabel(/^時間割方式/).selectOption("automatic");
    const planning = page.getByRole("checkbox", { name: "相対締切・資料リマインドを使用" });
    await planning.check();
    await planning.locator("..").hover();
    assert.equal(await page.getByRole("tooltip").isVisible(), true);
    await page.getByRole("heading", { name: "開催回の設定", exact: true }).click();
    assert.equal(await page.getByRole("tooltip").isVisible(), false);
    await planning.focus();
    assert.equal(await page.getByRole("tooltip").isVisible(), true);
    await page.getByRole("heading", { name: "開催回の設定", exact: true }).click();
    assert.equal(await page.getByText("設定の説明", { exact: true }).count(), 0);
    const checkbox = await planning.boundingBox();
    assert.equal(Math.round(checkbox.width), 18);
    const label = await planning.locator("..").boundingBox();
    assert.ok(label.height < 55);
    const form = await page.locator(".lt-event-form").boundingBox();
    const fields = await page.locator(".lt-event-form > fieldset").boundingBox();
    assert.ok(fields.width >= form.width - 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `.wrangler/lt-settings-${width}.png`, fullPage: true });
    await navigation.getByRole("button", { name: "タイムテーブル", exact: true }).click();
    if (width === 1280) await page.getByRole("button", { name: "開会を追加", exact: true }).click();
    const fixed = page.getByRole("checkbox", { name: "この枠の時刻を固定", exact: true }).first();
    await fixed.check();
    assert.equal(Math.round((await fixed.boundingBox()).width), 18);
    assert.ok((await fixed.locator("..").boundingBox()).height < 40);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `.wrangler/lt-timetable-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("LT UI: notifications, action navigation, isolated panels, draft retention, desktop/mobile PASS");
} finally { await browser.close(); }
