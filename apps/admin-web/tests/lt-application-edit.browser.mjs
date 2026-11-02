import { chromium } from "../../lt-web/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://docs.google.com/**", route => route.fulfill({ contentType: "text/html", body: "<p>Slide fixture</p>" }));
    await page.goto("http://127.0.0.1:24589/");
    await page.getByRole("button", { name: "架空LT会 辞退依頼の確認" }).click();
    await page.getByRole("button", { name: "申請情報を編集", exact: true }).click();
    const form = page.locator("form.application-form");
    await form.locator('select[name="field"]').selectOption("programming");
    await form.locator('select[name="difficulty"]').selectOption("normal");
    await form.getByRole("textbox", { name: /^名前/ }).fill("変更後の登壇者");
    await form.getByRole("textbox", { name: "所属", exact: true }).fill("変更後の所属");
    await form.getByRole("textbox", { name: "プロフィール", exact: true }).fill("プロフィール変更");
    await form.getByRole("textbox", { name: /^発表タイトル/ }).fill("管理者が編集した発表");
    // 編集フォームと保存後の詳細で同じ資料ビューを使うことを確認する
    await form.locator('input[name="materialUrl"]').fill("https://docs.google.com/presentation/d/admin_fixture/edit");
    assert.equal(await form.locator("iframe").getAttribute("src"), "https://docs.google.com/presentation/d/admin_fixture/preview");
    await form.getByRole("button", { name: "発表者を追加" }).click();
    await form.getByRole("textbox", { name: /^名前/ }).nth(1).fill("共同登壇者");
    assert.equal(await form.locator('input[name="privacyAccepted"]').count(), 0);
    await form.getByRole("button", { name: "変更を保存" }).click();
    await page.getByRole("heading", { name: "管理者が編集した発表", exact: true }).waitFor();
    assert.equal(await form.count(), 0);
    assert.equal(await page.locator("iframe").getAttribute("src"), "https://docs.google.com/presentation/d/admin_fixture/preview");
    await page.getByRole("button", { name: "申請情報を編集", exact: true }).click();
    assert.equal(await form.getByRole("textbox", { name: /^名前/ }).first().inputValue(), "変更後の登壇者");
    assert.equal(await form.getByRole("textbox", { name: "所属", exact: true }).first().inputValue(), "変更後の所属");
    assert.equal(await form.getByRole("textbox", { name: "プロフィール", exact: true }).first().inputValue(), "プロフィール変更");
    await form.getByRole("textbox", { name: /^発表タイトル/ }).fill("取り消す編集");
    await form.getByRole("button", { name: "戻る", exact: true }).click();
    await page.getByRole("heading", { name: "管理者が編集した発表", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:24589/?role=assistant");
  await page.getByRole("button", { name: "架空LT会 辞退依頼の確認" }).click();
  await page.getByRole("heading", { name: "架空発表", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "申請情報を編集", exact: true }).count(), 0);
  console.log("PASS: desktop/mobile edit, save, reopen, cancel, assistant visibility");
} finally {
  await browser.close();
}
