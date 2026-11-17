import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "product.spec.ts",
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3109",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npx tsx scripts/prepare-product-browser.ts && npm run dev -- --port 3109",
    url: "http://127.0.0.1:3109/api/health",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      FORGE_APP_MODE: "test",
      FORGE_DATA_DIR: `./artifacts/product-browser-state-${Date.now()}`,
      FORGE_PRODUCT_TEST_RESPONSES:
        "./artifacts/product-browser/responses.json",
      FORGE_RUNTIME_MODE: "fixture",
      MODEL_PROVIDER: "demo",
      STORE_PROVIDER: "local",
      SANDBOX_PROVIDER: "process",
      FORGE_MISSION_REQUEST_CAP: "0",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_CALENDAR_ID: "",
    },
  },
});
