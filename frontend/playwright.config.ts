import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE }
      : {},
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    env: { VITE_USE_MOCKS: "true" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
