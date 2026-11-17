import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3119", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npx next dev --hostname 127.0.0.1 --port 3119",
    url: "http://127.0.0.1:3119/",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { FORGE_HOME: `./artifacts/e2e-${Date.now()}`, FORGE_MODEL_TRANSPORT: "scripted", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
