import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.PW_BASE_URL ?? "http://127.0.0.1:3119", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  // PW_BASE_URL points the tests at an already running FORGE (e.g. the showcase build).
  webServer: process.env.PW_BASE_URL ? undefined : {
    command: "npx next dev --hostname 127.0.0.1 --port 3119",
    url: "http://127.0.0.1:3119/",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { FORGE_HOME: `./artifacts/e2e-${Date.now()}`, FORGE_MODEL_TRANSPORT: "scripted", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
