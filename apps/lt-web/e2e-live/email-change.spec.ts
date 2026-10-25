import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// 架空専用DBだけを使う。tokenをtrace・画像・ログへ保存しない。
test("実proxyとRustで代表者メール変更を最終確定する", async ({ browser }) => {
  const publicOrigin = "http://127.0.0.1:18880";
  const adminOrigin = "http://127.0.0.1:18920";
  const apiDir = resolve("../../services/lt-api");
  function sql(command: string) {
    const raw = execFileSync(
      "node",
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "execute",
        "lt-local",
        "--local",
        "--command",
        command,
        "--json",
      ],
      { cwd: apiDir, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(raw)[0].results;
  }
  sql("UPDATE lt_recruitment SET opens=0,closes=1");
  const oldContext = await browser.newContext(),
    operator = await browser.newContext(),
    newContext = await browser.newContext();
  const oldPage = await oldContext.newPage(),
    admin = await operator.newPage(),
    fresh = await newContext.newPage();
  const id = () => crypto.randomUUID();
  const oldEmail = id() + "@example.invalid",
    newEmail = id() + "@example.invalid";
  const headers = { Origin: publicOrigin, "Content-Type": "application/json", "X-LT-CSRF": "1" };
  async function login(page: typeof oldPage, email: string) {
    await page.goto(publicOrigin + "/login");
    await page.locator("input[name=email]").fill(email);
    await page.getByRole("button", { name: "確認案内を送る" }).click();
    await expect(page.getByRole("button", { name: "確認案内を送る" })).toBeEnabled();
    const mail = await (
      await fetch("http://127.0.0.1:18878/test/fake-mail", { method: "POST", body: email })
    ).json();
    const token = new URL(mail.confirmationUrl).searchParams.get("token")!;
    try {
      await page.goto(publicOrigin + "/auth/verify?token=" + encodeURIComponent(token));
    } catch {
      throw Error("Login navigation failed (redacted)");
    }
    await page.getByRole("button", { name: "確認する", exact: true }).click();
    await expect(page.getByRole("heading", { name: "本人申請", exact: true })).toBeVisible();
  }
  try {
    await admin.goto(adminOrigin);
    const title = "Email integration " + id().slice(0, 8);
    const created = await operator.request.post(adminOrigin + "/api/lt/v1/operator/events", {
      headers: { Origin: adminOrigin },
      data: {
        title,
        venue: "Fixture",
        guidance: "",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        timeZone: "UTC",
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 1800000).toISOString(),
        capacity: 2,
        talkMinutes: 10,
        transitionMinutes: 1,
        operationId: id(),
      },
    });
    expect(created.status()).toBe(200);
    const event = await created.json();
    await login(oldPage, oldEmail);
    const submitted = await oldContext.request.post(publicOrigin + "/api/lt/v1/applications", {
      headers,
      data: {
        eventId: event.id,
        operationId: id(),
        content: {
          title: "Email target",
          abstract: "Fixture abstract",
          speakers: [{ displayName: "Fixture speaker" }],
        },
        materialUrl: "https://example.invalid/slides",
      },
    });
    expect(submitted.status()).toBe(200);
    const app = await submitted.json();
    // 別開催の既存申請は、同じ旧メールでも移管対象にしない。
    const other = "email-other-" + id();
    sql(
      "INSERT INTO lt_events(id,state,public_opens_at,publish_enabled) VALUES('" +
        other +
        "','scheduled',0,0);INSERT INTO lt_applications(id,event_id,email,version,operation_id,payload_hash,dto) SELECT '" +
        other +
        "','" +
        other +
        "',email,1,'fixture','fixture',json_set(dto,'$.id','" +
        other +
        "','$.eventId','" +
        other +
        "') FROM lt_applications WHERE id='" +
        app.id +
        "'",
    );
    await admin.reload();
    await admin.getByRole("button", { name: new RegExp(title) }).click();
    await admin.getByRole("button", { name: /Email target/ }).click();
    const panel = admin.getByRole("region", { name: "代表者メール変更" });
    await panel.getByLabel("新しいメールアドレス").fill(newEmail);
    await panel.getByLabel("本人確認方法").fill("架空データの手動照合");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "本人確認を記録" }).click();
    await expect(panel.getByText("本人確認を記録しました", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "確認リンクを送信・再送" }).click();
    await expect(panel.getByText(/確認リンクの送信を受け付けました/)).toBeVisible();
    for (let batch = 0; batch < 20; batch++) {
      const delivered = await fetch("http://127.0.0.1:18878/test/dispatch-fake");
      expect(delivered.status).toBe(200);
      if ((await delivered.json()).delivered === 0) break;
      expect(batch).toBeLessThan(19);
    }
    const mail = await (
      await fetch("http://127.0.0.1:18878/test/change-mail", { method: "POST", body: newEmail })
    ).json();
    const token = new URL(mail.confirmationUrl).searchParams.get("token")!;
    try {
      await fresh.goto(publicOrigin + "/auth/email-change?token=" + encodeURIComponent(token));
    } catch {
      throw Error("Change navigation failed (redacted)");
    }
    await expect(fresh).toHaveURL(publicOrigin + "/auth/email-change");
    expect(
      (await oldContext.request.get(publicOrigin + "/api/lt/v1/applications/" + app.id)).status(),
    ).toBe(200);
    expect((await newContext.request.get(publicOrigin + "/api/lt/v1/auth/session")).status()).toBe(
      200,
    );
    expect(
      await (await newContext.request.get(publicOrigin + "/api/lt/v1/auth/session")).json(),
    ).toBeNull();
    await fresh.getByRole("button", { name: "メールアドレスを確認する" }).click();
    await expect(
      fresh.getByText("メールアドレスを確認しました。運営の最終確定をお待ちください。", {
        exact: true,
      }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "変更状態を再読込" }).click();
    await expect(panel.getByRole("button", { name: "メール変更を最終確定" })).toBeEnabled();
    await panel.getByRole("button", { name: "メール変更を最終確定" }).click();
    await expect(panel.getByText(/変更が確定しました/)).toBeVisible();
    expect(
      (await oldContext.request.get(publicOrigin + "/api/lt/v1/applications/" + app.id)).status(),
    ).toBe(401);
    await login(fresh, newEmail);
    const moved = await newContext.request.get(publicOrigin + "/api/lt/v1/applications/" + app.id);
    expect(moved.status()).toBe(200);
    expect((await moved.json()).representativeEmail).toBe(newEmail);
    expect(
      (await newContext.request.get(publicOrigin + "/api/lt/v1/applications/" + other)).status(),
    ).toBe(404);
    expect(sql("SELECT email FROM lt_applications WHERE id='" + other + "'")[0].email).toBe(
      oldEmail,
    );
    await login(oldPage, oldEmail);
    expect(
      (await oldContext.request.get(publicOrigin + "/api/lt/v1/applications/" + app.id)).status(),
    ).toBe(404);
    for (const page of [fresh, admin]) {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally {
    await oldContext.close();
    await operator.close();
    await newContext.close();
  }
});
