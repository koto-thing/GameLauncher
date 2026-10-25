import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-live",
  workers: 1,
  timeout: 120000,
  use: {
    actionTimeout: 15000,
    baseURL: "http://127.0.0.1:18880",
    channel: "chrome",
    headless: true,
    timezoneId: "UTC",
    trace: "off",
    screenshot: "off",
  },
  reporter: "list",
});
