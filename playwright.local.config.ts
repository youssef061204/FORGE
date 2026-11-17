import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "local-files.spec.ts",
  timeout: 600000,
  expect: { timeout: 180000 },
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/local-synthesis/browser-report.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3111",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3111",
    url: "http://127.0.0.1:3111/api/health",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      FORGE_DATA_DIR: `./artifacts/local-browser-state-${Date.now()}`,
      FORGE_FREE_ONLY: "true",
      FORGE_RUNTIME_MODE: "fixture",
      FORGE_INTERACTIVE_PROVIDER: "local",
      FORGE_LOCAL_MODEL: "qwen2.5:7b-instruct",
      FORGE_LOCAL_MODEL_URL: "http://127.0.0.1:11435",
      FORGE_PRODUCT_TEST_RESPONSES: "",
      MODEL_PROVIDER: "demo",
      STORE_PROVIDER: "local",
      SANDBOX_PROVIDER: "process",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_CALENDAR_ID: "",
    },
  },
});
