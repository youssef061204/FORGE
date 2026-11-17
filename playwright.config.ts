import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["product.spec.ts", "local-files.spec.ts", "core-reliability.spec.ts"],
  timeout: 120000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3107",
    url: "http://127.0.0.1:3107/api/health",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      FORGE_DATA_DIR: `./artifacts/e2e-state-${Date.now()}`,
      DEMO_MODE: "true",
      FORGE_RUNTIME_MODE: "fixture",
      MODEL_PROVIDER: "demo",
      STORE_PROVIDER: "local",
      SANDBOX_PROVIDER: "process",
      FORGE_FUTURES_MODE: "exhaustive",
    },
  },
});
