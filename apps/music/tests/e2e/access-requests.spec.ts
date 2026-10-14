import { test, expect } from "@playwright/test";

/** @brief 管理画面で招待を作り、別ブラウザーの本人が受諾して全作品にアクセスする */
test("executive invitation grants assistant access only after recipient accepts", async ({ page, browser }) => {
  const origin = "http://127.0.0.1:8788";
  await page.goto(`${origin}/api/auth/dev?as=outsider`);
  await page.goto(`${origin}/members`);
  await expect(page.getByText("あなたの役割", { exact: true })).toBeVisible();
  await expect(page.getByText("一般利用者", { exact: true })).toBeVisible();
  const reviewer = await browser.newPage();
  try {
    await reviewer.goto(`${origin}/api/auth/dev?as=maintainer`);
    await reviewer.goto(`${origin}/members`);
    await reviewer.getByLabel("招待する人").selectOption("900004");
    await expect(reviewer.getByLabel("招待する役割",{exact:true}).locator("option")).toHaveCount(1);
    await expect(reviewer.getByRole("button", { name: /の役割を保存$/ })).toHaveCount(0);
    await reviewer.getByRole("button",{name:"招待を作成",exact:true}).click();
    await expect(reviewer.getByRole("status").filter({ hasText: "招待を作成しました" })).toBeVisible();
    await page.reload();
    await page.getByRole("button",{name:"招待を受諾",exact:true}).first().click();
    await expect(page.getByText("幹部補佐", { exact: true })).toBeVisible();
    await expect(page.getByRole("button",{name:"招待を作成",exact:true})).toHaveCount(0);
    await page.goto(`${origin}/music`);
    await expect(page.getByRole("link").filter({hasText:"DEMO 2 / 夜の航路"})).toBeVisible();
  } finally {
    await reviewer.goto(`${origin}/api/auth/dev?as=admin`);
    await reviewer.request.post(`${origin}/api/members`,{headers:{Origin:origin},data:{action:"set_role",githubUserId:"900004",role:"user"}});
    await reviewer.close();
  }
});
