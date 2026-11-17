import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { digest } from "../src/forge/hash";
const origin = new URL(process.env.FORGE_VERIFY_URL ?? "http://127.0.0.1:3118");
assert(
  ["localhost", "127.0.0.1"].includes(origin.hostname) &&
    origin.port !== "3108",
  "Use a disposable loopback instance, never the main City",
);
assert(
  process.env.FORGE_VERIFY_ISOLATED === "true",
  "Explicit isolated verification flag required",
);
const headers: Record<string, string> = process.env.FORGE_API_TOKEN
  ? { Authorization: "Bearer " + process.env.FORGE_API_TOKEN }
  : {};
const path = "artifacts/final-research-http-proof.json";
await writeFile(
  path,
  JSON.stringify({ passed: false, startedAt: new Date().toISOString() }),
);
async function get() {
  const r = await fetch(new URL("/api/environment?forecast=60", origin), {
    headers,
  });
  assert(r.ok, "Environment HTTP " + r.status);
  return r.json();
}
async function post(body: unknown, route = "/api/environment") {
  const r = await fetch(new URL(route, origin), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  assert(
    r.ok,
    "Owner operation HTTP " + r.status + ": " + JSON.stringify(result),
  );
  return result;
}
if (process.env.FORGE_API_TOKEN) {
  assert.equal(
    (await fetch(new URL("/api/gpu", origin), { method: "POST" })).status,
    401,
  );
  assert.equal(
    (
      await fetch(new URL("/api/gpu", origin), {
        method: "POST",
        headers: { ...headers, Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
}
await post({ action: "control", change: { operation: "pause", paused: true } });
const base = await get();
assert.equal(base.runtime.mode, "fixture");
await post({ action: "model", variant: "queue-adapted-2" });
const promoted = await get();
assert.equal(promoted.forecast.version, "queue-adapted-2");
const queue = (state: typeof base) =>
  state.forecast.nodes.map(
    (n: { values: { queue: number } }) => n.values.queue,
  );
assert.notDeepEqual(
  queue(promoted),
  queue(base),
  "Promotion must change actual predictions",
);
await post({ action: "model", variant: "base" });
const rolledBack = await get();
assert.deepEqual(
  rolledBack.forecast,
  base.forecast,
  "Rollback must restore actual predictions",
);
assert.equal(digest(rolledBack.city), digest(base.city));
await post({
  action: "control",
  change: {
    operation: "hazard.create",
    kind: "flood",
    x: 840,
    y: 650,
    radius: 190,
    intensity: 0.7,
  },
});
await post({
  action: "control",
  change: {
    operation: "hazard.create",
    kind: "gas",
    x: 840,
    y: 650,
    radius: 300,
    intensity: 1,
  },
});
const beforeGPU = await get(),
  gpuStarted = performance.now();
const gpu = await post({ batch: 1000 }, "/api/gpu");
assert.equal(gpu.provider, "CUDA / PyTorch");
assert.equal(gpu.batch, 1000);
assert.match(gpu.device, /NVIDIA/);
assert.equal(gpu.authority, false);
assert(
  gpu.worst > 0,
  "Actual hazardous fields must produce a nonzero threshold outcome",
);
const gpuHTTPMs = Math.round(performance.now() - gpuStarted);
assert.equal(
  digest((await get()).city),
  digest(beforeGPU.city),
  "GPU evaluation is read-only",
);
await post({ action: "map", name: "kingston" });
const imported = await get();
assert.equal(imported.city.map.source, "OpenStreetMap");
assert.equal(imported.city.nodes.length, 64);
assert.equal(imported.forecast.lowConfidence, true);
assert.equal(imported.forecast.fallback, "full-simulation");
assert(!imported.city.deployment);
await post({ action: "map", name: "northbank" });
assert.equal((await get()).city.id, base.city.id);
await post({
  action: "control",
  change: { operation: "pause", paused: false },
});
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: headers,
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin.href);
  const canvas = page.locator("canvas").first();
  await canvas.waitFor();
  await page.waitForTimeout(12000);
  const follow = await canvas.evaluate((e) => ({
    ...(e as HTMLCanvasElement).dataset,
  }));
  await page.screenshot({
    path: "artifacts/final-city-production.png",
    fullPage: true,
  });
  await canvas.focus();
  await page.keyboard.press("m");
  await page.waitForTimeout(12000);
  const overview = await canvas.evaluate((e) => ({
    ...(e as HTMLCanvasElement).dataset,
  }));
  const scene = await get();
  await page.getByRole("button", { name: "Open context inspector" }).click();
  await page.getByRole("tab", { name: "CAMERAS", exact: true }).click();
  await page.getByRole("img", { name: "Virtual camera feed" }).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: "artifacts/final-camera-production.png",
    fullPage: true,
  });
  const shadowDeadline = Date.now() + 90000;
  let shadow = (await get()).forecastMonitor;
  while (!shadow.shadow.completedPairs && Date.now() < shadowDeadline) {
    await page.waitForTimeout(5000);
    shadow = (await get()).forecastMonitor;
  }
  assert(
    shadow.shadow.completedPairs > 0,
    "Actual +60-second runtime shadow outcomes required",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path,
    JSON.stringify(
      {
        passed: true,
        completedAt: new Date().toISOString(),
        fixtureDefault: true,
        modelPromotionChangesPrediction: true,
        rollbackRestoresPrediction: true,
        osmNodes: 64,
        osmRequiresFullSimulation: true,
        restoredCity: base.city.id,
        gpuHTTPMs,
        gpu,
        gpuReadOnly: true,
        shadow,
        ownerAuthVerified: !!process.env.FORGE_API_TOKEN,
        browser: {
          viewport: { width: 1440, height: 900 },
          follow,
          overview,
          entities: {
            vehicles: scene.city.vehicles.length,
            pedestrians: scene.city.pedestrians.length,
            hazards: scene.city.hazards.filter(
              (h: { active: boolean }) => h.active,
            ).length,
          },
          errors,
          scope:
            "Headless Chromium on this host; samples from requestAnimationFrame, not a hardware display guarantee",
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      gpuHTTPMs,
      gpu: gpu.device,
      followFPS: follow.averageFps,
      overviewFPS: overview.averageFps,
      errors,
    }),
  );
} finally {
  await browser.close();
}
