import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-readonly",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5190", channel: "chrome", headless: true },
  webServer: {
    command: "npm run dev -- --port 5190 --strictPort",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: false,
    env: {
      VITE_LT_APPLICATIONS_ENABLED: "false",
      VITE_LT_QA: "false",
      VITE_LT_FIXTURE: "false",
    },
  },
  reporter: "list",
});
