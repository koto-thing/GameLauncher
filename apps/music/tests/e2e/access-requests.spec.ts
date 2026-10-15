import { test, expect } from "@playwright/test";

// サーバー境界はintegration/access-requests.test.ts、ここでは実画面の入力・確認・権限制約を検証する
test("username-only pre-invitation keeps the member UI and executive role limits", /** @brief ユーザー名だけで本人確認から招待へ進める */ async ({page}) => {
  const origin="http://127.0.0.1:8788";
  await page.goto(origin+"/api/auth/dev?as=maintainer");
  let invited=false;
  await page.route("**/api/members",/** @brief UIの契約だけを固定し本物の権限テストと分離する */ async route=>{
    const request=route.request();
    if(request.method()==="GET") return route.fulfill({json:{role:"executive",users:[{id:"1002",login:"pandd-maintainer",role:"executive"}],invitations:invited?[{id:"invite",login:"new-operator",role:"assistant",expires_at:"2030-01-01T00:00:00Z"}]:[]}});
    const input=request.postDataJSON();
    if(input.action==="lookup") {
      expect(input).toEqual({action:"lookup",login:"new-operator"});
      return route.fulfill({json:{id:900004,login:"new-operator",avatar_url:""}});
    }
    if(input.action==="invite") {
      expect(input).toEqual({action:"invite",login:"new-operator",confirmedId:"900004",role:"assistant"});
      invited=true;
      return route.fulfill({status:201,json:{id:"invite"}});
    }
    expect(input.action).toBe("revoke_invitation");
    invited=false;
    return route.fulfill({json:{ok:true}});
  });
  await page.goto(origin+"/members");
  await expect(page.locator(".members-current-role")).toContainText("幹部");
  await expect(page.getByLabel("GitHubユーザー名",{exact:true})).toBeVisible();
  await expect(page.getByText("一般利用者",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"招待を作成",exact:true})).toHaveCount(0);
  await page.getByLabel("GitHubユーザー名",{exact:true}).fill("new-operator");
  await page.getByRole("button",{name:"GitHubで本人を確認",exact:true}).click();
  await expect(page.getByRole("link",{name:"@new-operator",exact:true})).toHaveAttribute("href","https://github.com/new-operator");
  await expect(page.getByLabel("招待する役割",{exact:true}).locator("option")).toHaveCount(1);
  await expect(page.getByLabel("手続き",{exact:true}).locator("option")).toHaveCount(1);
  await expect(page.getByRole("button",{name:/の役割を保存$/})).toHaveCount(0);
  await page.getByRole("button",{name:"招待を作成",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"招待を作成しました"})).toBeVisible();
  await page.screenshot({path:"build/members-preinvite-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"build/members-preinvite-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"招待を取消",exact:true}).click();
  await expect(page.getByRole("button",{name:"招待を取消",exact:true})).toHaveCount(0);
});

test("unapproved local identity cannot reach members or Music management",/** @brief 一般利用者セッションを発行しない */ async ({page})=>{
  const origin="http://127.0.0.1:8788";
  const response=await page.goto(origin+"/api/auth/dev?as=outsider");
  expect(response!.status()).toBe(403);
  await page.goto(origin+"/members");
  await expect(page.getByRole("heading",{name:"GitHubでログイン"})).toBeVisible();
  const api=await page.request.get(origin+"/api/music/manage/games");
  expect(api.status()).toBe(401);
});
