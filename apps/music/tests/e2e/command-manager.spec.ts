import { test, expect } from "@playwright/test";
import { displayCommand, encodeCommand } from "../../src/domain/command-code";

test("manager confirms permanent code, prints only the sheet and issues unpublished codes", /** @brief 実管理APIで確認・発行し、印刷対象と公開状態を検査する */ async ({
  page,
}, info) => {
  const games = await (await page.request.get("/api/public/catalogue")).json();
  const game = games[0],
    track = game.tracks[0];
  await page.goto("http://127.0.0.1:8788/api/auth/dev?as=music-admin");
  await page.goto(`http://127.0.0.1:8788/music#/manage/tracks/${track.id}`);
  const panel = page.getByRole("region", { name: "コマンドコード管理" });
  await expect(panel.locator(".command-text")).toHaveText(
    displayCommand(encodeCommand(track.commandCode.codeId)),
  );
  await page.reload();
  await expect(panel.locator(".command-image")).toBeVisible();
  await page.evaluate(
    /** @brief OSの印刷ダイアログを開かず呼出し回数を確認する */ () => {
      window.print = /** @brief 印刷要求をテスト内だけで数える。 */ () => {
        document.documentElement.dataset.printCalls = String(
          Number(document.documentElement.dataset.printCalls ?? 0) + 1,
        );
      };
    },
  );
  await panel.getByRole("button", { name: "曲名付きで印刷" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-calls", "1");
  const imageSource = await panel.locator("img").getAttribute("src");
  await page.emulateMedia({ media: "print" });
  const sheet = page.locator("body > .command-print-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("h1")).toHaveText(track.title);
  await expect(panel).not.toBeVisible();
  await expect(sheet.locator("img")).toHaveAttribute("src", imageSource ?? "");
  await page.screenshot({
    path: `build/command-code/manager-print-${info.project.name}.png`,
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await expect(sheet).not.toBeVisible();
  await panel
    .getByRole("button", { name: "作品の公開済み曲へコードだけ反映" })
    .click();
  await expect(panel.getByRole("status")).toContainText("反映しました");
  await page.screenshot({
    path: `build/command-code/manager-${info.project.name}.png`,
    fullPage: true,
  });

  const endpoint = `http://127.0.0.1:8788/api/music/manage/games/${game.id}/tracks`;
  const headers = {
    Origin: "http://127.0.0.1:8788",
    "X-CSRF-Token": "same-origin",
  };
  const created = await page.request.post(endpoint, {
    headers,
    data: { title: "印刷用の未公開曲" },
  });
  expect(created.ok()).toBe(true);
  const draft = await created.json();
  // この曲は実行ごとの隔離DBだけに作り、公開しない存在しない削除APIは呼ばない
  await page.goto(`http://127.0.0.1:8788/music#/manage/tracks/${draft.id}`);
  await expect(
    panel.getByRole("button", { name: "コマンドコードを発行", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "コマンドコードを発行", exact: true })
    .click();
  await expect(panel.locator(".command-image")).toBeVisible();
  const value = await panel.locator(".command-text").innerText();
  await page.reload();
  await expect(panel.locator(".command-text")).toHaveText(value);
  const managed = await (
    await page.request.get(
      `http://127.0.0.1:8788/api/music/manage/tracks/${draft.id}`,
    )
  ).json();
  expect(managed.track.published).toBeNull();
});
