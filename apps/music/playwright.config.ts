import { defineConfig } from "@playwright/test";

// 実ブラウザー3種で同じ導線を検証し、ローカルの編集データは別ポートで保護する。
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["json", { outputFile: "build/e2e-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:8088",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
