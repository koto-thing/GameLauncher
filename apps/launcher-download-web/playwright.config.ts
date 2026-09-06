import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7000 },
  reporter: [["list"], ["json", { outputFile: "build/e2e-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:5181/launcher/",
    viewport: { width: 1366, height: 768 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
