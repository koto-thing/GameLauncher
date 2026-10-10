import { test, expect, type Page, type TestInfo, type Download } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adminOrigin = "http://127.0.0.1:8788";
const artwork = fileURLToPath(new URL("../../public/pandd-logo.png", import.meta.url));

// Artifact生成と実際の分割送信を3ブラウザーで完了できる時間を確保する
test.setTimeout(90000);

/** @brief 実際の生成とローカルIntake送信を行うために画像と小さなBuildフォルダを選択する */
async function prepareArtifact(page: Page, info: TestInfo): Promise<void> {
  const buildDirectory = info.outputPath("GameBuild");
  await mkdir(buildDirectory, { recursive: true });
  await writeFile(path.join(buildDirectory, "TestGame.exe"), "MZ descriptor download test");

  const login = await page.request.get(`${adminOrigin}/api/auth/dev?as=admin`, { maxRedirects: 0 });
  expect(login.status()).toBe(302);
  await page.goto(`${adminOrigin}/intake`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".account .avatar")).toBeVisible({ timeout: 30000 });
  await page.locator("#game-id-input").fill(`descriptor-${info.project.name}`);
  await page.locator("#save-dir-input").fill("DescriptorTest");
  await page.getByPlaceholder("ja-JP のゲーム名").fill("Descriptorの保存テスト");
  await page.getByPlaceholder("ja-JP の説明・概要").fill("アップロード完了後に受付票を保存します");
  await page.locator('.image-picker-card input[type="file"]').nth(0).setInputFiles(artwork);
  await page.locator('.image-picker-card input[type="file"]').nth(1).setInputFiles(artwork);
  await page.locator("input[webkitdirectory]").setInputFiles(buildDirectory);
  await expect(page.getByRole("button", { name: "Artifactを作成してアップロード", exact: true })).toBeEnabled();
}

test("downloads the sealed descriptor once and allows manual saving again", /** @brief Sealした受付票と保存ファイルが一致し、表示更新で重複保存しないことを検証する */ async ({ page }, info) => {
  await prepareArtifact(page, info);
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  const submitted = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/intake/uploads");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Artifactを作成してアップロード", exact: true }).click();

  const descriptor = (await submitted).postDataJSON();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(`${descriptor.artifactId}.pandd-artifact.json`);
  const savedPath = info.outputPath("descriptor.json");
  await download.saveAs(savedPath);
  expect(JSON.parse(await readFile(savedPath, "utf8"))).toEqual(descriptor);
  await expect(page.getByText("Uploadが完了しました", { exact: true })).toBeVisible();
  await page.locator(".theme-toggle").click();
  await expect(page.locator(".theme-toggle")).toBeEnabled();
  expect(downloads).toHaveLength(1);

  const savedAgain = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descriptorを保存 (.json)", exact: true }).click();
  expect((await savedAgain).suggestedFilename()).toBe(download.suggestedFilename());
  expect(downloads).toHaveLength(2);
});

test("does not automatically download a descriptor when seal fails", /** @brief 完成したZIPがあっても受付の失敗時には自動保存を開始しない */ async ({ page }, info) => {
  await prepareArtifact(page, info);
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await page.route("**/api/intake/uploads/*/seal", route => route.fulfill({ status: 500, json: { error: "Seal test failure" } }));
  await page.getByRole("button", { name: "Artifactを作成してアップロード", exact: true }).click();
  await expect(page.getByText("エラーが発生しました", { exact: true })).toBeVisible();
  expect(downloads).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Descriptorを保存 (.json)", exact: true })).toBeEnabled();
});
