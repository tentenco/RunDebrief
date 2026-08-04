import { defineConfig } from "@playwright/test";

const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  tsconfig: "./tsconfig.playwright.json",
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:1420",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      executablePath: chromeExecutable,
    },
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "VITE_DEBRIEF_DEMO=1 pnpm dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
