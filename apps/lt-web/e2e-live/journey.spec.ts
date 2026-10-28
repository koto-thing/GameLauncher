import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
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
    { cwd: apiDir, timeout: 30000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(raw)[0].results;
}
test("実UIと実routeで確認から公開・再承認・時間割・辞退・中止まで", async ({ browser }) => {
  sql("UPDATE lt_recruitment SET opens=0,closes=1");
  const applicant = await browser.newContext({ timezoneId: "UTC" }),
    operator = await browser.newContext({ timezoneId: "UTC" });
  const page = await applicant.newPage(),
    admin = await operator.newPage();
  page.on("requestfailed", (r) =>
    console.log("failed path", new URL(r.url()).pathname, r.failure()?.errorText),
  );
  let event: any;
  const op = () => crypto.randomUUID();
  const origin = "http://127.0.0.1:18920";
  const headers = { Origin: origin, "Content-Type": "application/json" };
  try {
    console.log("stage admin");
    await admin.goto(origin);
    await expect(admin.getByRole("heading", { name: "LT会", exact: true })).toBeVisible();
    const start = new Date(Date.now() + 3600000);
    start.setUTCSeconds(0, 0);
    const fields = {
      title: "Live integration " + op().slice(0, 8),
      venue: "Fixture room",
      guidance: "",
      startsAt: start.toISOString(),
      timeZone: "UTC",
      opensAt: new Date(Date.now() - 3600000).toISOString(),
      closesAt: new Date(Date.now() + 1800000).toISOString(),
      capacity: 2,
      talkMinutes: 10,
      transitionMinutes: 1,
      approvalMode: "manual",
      scheduleMode: "manual",
      openingMinutes: 0,
      breakEvery: 4,
      breakMinutes: 0,
      closingMinutes: 0,
      endsBy: null,
    };
    const created = await operator.request.post(origin + "/api/lt/v1/operator/events", {
      headers,
      data: { ...fields, operationId: op() },
    });
    expect(created.status()).toBe(200);
    event = await created.json();
    await admin.reload();
    await admin
      .locator(".lt-event-list")
      .getByRole("button", { name: new RegExp(fields.title) })
      .click();
    console.log("stage login");
    await page.goto("http://127.0.0.1:18880/login");
    const email = op() + "@example.invalid";
    await page.locator("input[name=email]").fill(email);
    const sent = page.waitForResponse(
      (r) => r.url().endsWith("/auth/email") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "確認案内を送る" }).click();
    expect((await sent).status()).toBe(202);
    await expect(page.getByRole("button", { name: "確認案内を送る" })).toBeEnabled();
    // 先行テストの待機メールも含め、テスト専用配送処理を完了する
    const dispatched = await fetch("http://127.0.0.1:18878/test/dispatch-fake");
    expect(dispatched.ok).toBe(true);
    const mail = await fetch("http://127.0.0.1:18878/test/fake-mail", {
      method: "POST",
      body: email,
    });
    const confirmation = await mail.json();
    const token = new URL(confirmation.confirmationUrl).searchParams.get("token");
    try {
      await page.goto("http://127.0.0.1:18880/auth/verify?token=" + encodeURIComponent(token!));
    } catch {
      throw Error("Confirmation navigation failed (redacted)");
    }
    console.log("stage verify");
    await page.getByRole("button", { name: "確認する", exact: true }).click();
    await expect(page.getByRole("heading", { name: "本人申請", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新規申請", exact: true }).click();
    await page.locator("select[name=eventId]").selectOption(event.id);
    console.log("stage application");
    await page.locator("input[name=title]").fill("Live talk");
    await page.locator("textarea[name=abstract]").fill("Public abstract");
    await page.getByLabel("名前", { exact: true }).first().fill("Fixture speaker");
    await page.locator("input[name=materialUrl]").fill("https://example.invalid/private-material");
    await page.getByRole("combobox", { name: "分野 ＊", exact: true }).selectOption("programming");
    await page.getByRole("combobox", { name: "難易度 ＊", exact: true }).selectOption("normal");
    await page.getByRole("checkbox", { name: "プライバシーポリシーを確認し、同意します" }).check();
    await page.getByRole("button", { name: "申請する", exact: true }).click();
    await expect(page.getByRole("heading", { name: "本人申請", exact: true })).toBeVisible();
    const apps = await (
      await applicant.request.get("http://127.0.0.1:18880/api/lt/v1/applications")
    ).json();
    const app = apps.items.find((a: any) => a.eventId === event.id);
    expect(app.eventState).toBe("scheduled");
    await admin.reload();
    await admin
      .locator(".lt-event-list")
      .getByRole("button", { name: new RegExp(fields.title) })
      .click();
    await admin
      .locator("#lt-applications")
      .getByRole("button", { name: "Live talk", exact: true })
      .click();
    await admin.getByLabel("発表開始日時", { exact: true }).fill(fields.startsAt.slice(0, 16));
    await admin.getByRole("button", { name: "承認", exact: true }).click();
    await expect(admin.getByText("保存しました", { exact: true })).toBeVisible();
    const publicUrl = "http://127.0.0.1:18880/api/lt/v1/events/" + event.id + "/talks/" + app.id;
    let published = await (await applicant.request.get(publicUrl)).json();
    expect(published.title).toBe("Live talk");
    expect(JSON.stringify(published)).not.toContain("example.invalid");
    await admin.getByRole("button", { name: "差し戻し", exact: true }).click();
    await expect(admin.getByText("保存しました", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await page.locator("input[name=title]").fill("Revised talk");
    await page.getByRole("checkbox", { name: "プライバシーポリシーを確認し、同意します" }).check();
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await expect(page.getByRole("heading", { name: "本人申請", exact: true })).toBeVisible();
    published = await (await applicant.request.get(publicUrl)).json();
    expect(published.title).toBe("Live talk");
    await page.getByRole("button", { name: "再提出", exact: true }).click();
    await expect(page.getByRole("button", { name: "再提出", exact: true })).toHaveCount(0);
    await admin.reload();
    await admin
      .locator(".lt-event-list")
      .getByRole("button", { name: new RegExp(fields.title) })
      .click();
    await admin
      .locator("#lt-applications")
      .getByRole("button", { name: "Revised talk", exact: true })
      .click();
    await admin.getByRole("button", { name: "再承認", exact: true }).click();
    await expect(admin.getByText("保存しました", { exact: true })).toBeVisible();
    published = await (await applicant.request.get(publicUrl)).json();
    expect(published.title).toBe("Revised talk");
    const scheduleUrl = origin + "/api/lt/v1/operator/events/" + event.id + "/timetable";
    const timetable = await (await operator.request.get(scheduleUrl)).json();
    const shifted = timetable.blocks.map((b: any) => ({
      ...b,
      startsAt: new Date(Date.parse(b.startsAt) + 120000).toISOString(),
      endsAt: new Date(Date.parse(b.endsAt) + 120000).toISOString(),
    }));
    shifted.unshift({
      id: op(),
      kind: "opening",
      startsAt: fields.startsAt,
      endsAt: new Date(Date.parse(fields.startsAt) + 120000).toISOString(),
    });
    const saved = await operator.request.put(scheduleUrl, {
      headers,
      data: {
        expectedVersion: timetable.version,
        operationId: op(),
        data: { blocks: shifted, expectedEventVersion: timetable.eventVersion },
      },
    });
    expect(saved.status()).toBe(200);
    published = await (await applicant.request.get(publicUrl)).json();
    expect(published.title).toBe("Revised talk");
    expect(published.startsAt).toBe(shifted[1].startsAt);
    await page.reload();
    await page.getByRole("button", { name: "辞退依頼", exact: true }).click();
    await expect(page.getByRole("button", { name: "辞退依頼を取消", exact: true })).toBeVisible();
    await admin.reload();
    await admin
      .locator(".lt-event-list")
      .getByRole("button", { name: new RegExp(fields.title) })
      .click();
    await admin
      .locator("#lt-applications")
      .getByRole("button", { name: "Revised talk", exact: true })
      .click();
    await admin.getByRole("button", { name: "辞退確定", exact: true }).click();
    await expect(admin.getByText("保存しました", { exact: true })).toBeVisible();
    published = await (await applicant.request.get(publicUrl)).json();
    expect(published.cancelled).toBe(true);
    await admin.getByRole("button", { name: "申請一覧に戻る" }).click();
    await admin.bringToFront();

    await expect(admin.getByRole("button", { name: "開催中止", exact: true })).toBeEnabled();
    console.log("stage cancel");
    admin.on("request", (r) => {
      if (new URL(r.url()).pathname.includes("/operator/"))
        console.log("operator path", r.method(), new URL(r.url()).pathname);
    });
    admin.on("pageerror", (e) => console.log("page exception", e.name));
    const cancelledResponse = admin.waitForResponse(
      (r) => r.url().endsWith("/cancel") && r.request().method() === "POST",
    );
    await admin.getByRole("button", { name: "開催中止", exact: true }).click();
    await admin.locator('[aria-label="開催中止の確認"] button').first().click();
    expect((await cancelledResponse).status()).toBe(200);
    await expect(admin.getByText("保存しました", { exact: true })).toBeVisible();
    expect((await applicant.request.get(publicUrl)).status()).toBe(404);
    await page.reload();
    await expect(page.getByText("この開催回は中止されました", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    // 専用の架空DBだけを使う。ブラウザー終了中にD1 CLIを起動しない
    await applicant.close();
    await operator.close();
  }
});
