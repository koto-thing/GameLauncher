import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5180", channel: "chrome", headless: true },
  webServer: {
    command: "npm run dev -- --port 5180 --strictPort",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
    env: { VITE_LT_QA: "true", VITE_LT_FIXTURE: "false" },
  },
  reporter: "list",
});
