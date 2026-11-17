import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// Production-only browser proof. It never submits a goal or invokes a tool.
// Voice events and microphone permission are browser doubles, not live STT.
const base = process.env.FORGE_UI_PROOF_URL ?? "http://127.0.0.1:3108";
const origin = new URL(base).origin;
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = "artifacts/next-production-ui.json";
const voiceOutput = "artifacts/next-production-ui-voice.json";
const at = new Date().toISOString();
const started = performance.now();
await mkdir("artifacts", { recursive: true });

type NetworkEvent = {
  method: string;
  path: string;
  status?: number;
  error?: string;
};
type VoiceHarness = {
  mode: "success" | "denied";
  mediaRequests: number;
  tracksStopped: number;
  constructions: number;
  starts: number;
  stops: number;
  aborts: number;
  emit(texts: string[], final: boolean): void;
};
type VoiceWindow = Window & { productionVoiceHarness: VoiceHarness };

const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const apiResponses: NetworkEvent[] = [];
const apiErrors: NetworkEvent[] = [];
const requestFailures: NetworkEvent[] = [];
const expectedTransportResponses: NetworkEvent[] = [];
const expectedNavigationAborts: NetworkEvent[] = [];
const prohibitedRequests: Array<{
  method: string;
  path: string;
  reason: string;
}> = [];
const pages: Array<Record<string, unknown>> = [];
const voice: Record<string, unknown> = {
  at,
  base,
  passed: false,
  method: "Injected browser SpeechRecognition and getUserMedia doubles",
  liveSpeechRecognitionVerified: false,
  realMicrophoneUsed: false,
  goalSubmitted: false,
};
const evidence: Record<string, unknown> = {
  at,
  base,
  passed: false,
  command: "npx tsx scripts/verify-next-production-ui.ts",
  serverStartedByProof: false,
  goalSubmissions: 0,
  toolInvocations: 0,
  modelInvocations: 0,
  pages,
  pageErrors,
  consoleErrors,
  apiResponses,
  apiErrors,
  requestFailures,
  expectedTransportResponses,
  expectedNavigationAborts,
  prohibitedRequests,
  voiceProof: voiceOutput,
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(process.env.FORGE_API_TOKEN
    ? {
        extraHTTPHeaders: {
          Authorization: "Bearer " + process.env.FORGE_API_TOKEN,
        },
      }
    : {}),
});

async function guardRequests(target: BrowserContext) {
  await target.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return route.continue();
    let reason = "";
    if (url.origin !== origin)
      reason = "External network access is outside this proof";
    else if (
      url.pathname.startsWith("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    ) {
      const message = request.postDataJSON() as { method?: string } | null;
      const allowedMcpRead =
        /^\/api\/mcp(?:\/fixture)?$/.test(url.pathname) &&
        ["initialize", "notifications/initialized", "tools/list"].includes(
          message?.method ?? "",
        );
      if (!allowedMcpRead)
        reason = "API mutations, model requests and tool calls are forbidden";
    }
    if (reason) {
      prohibitedRequests.push({
        method: request.method(),
        path: url.pathname,
        reason,
      });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
}

function observe(page: Page) {
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const item = {
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
    };
    apiResponses.push(item);
    if (item.status < 400) return;
    if (
      item.method === "GET" &&
      /^\/api\/mcp(?:\/fixture)?$/.test(item.path) &&
      item.status === 405
    )
      expectedTransportResponses.push(item);
    else apiErrors.push(item);
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const item = {
      method: request.method(),
      path: url.pathname,
      error: request.failure()?.errorText ?? "unknown",
    };
    if (/mcp/.test(item.path) && /abort|cancel/i.test(item.error))
      expectedNavigationAborts.push(item);
    else requestFailures.push(item);
  });
}

async function screenshot(page: Page, name: string) {
  const path = `artifacts/next-production-ui-${name}.png`;
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  const bytes = await readFile(path);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

async function loadedHome(page: Page) {
  const snapshot = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/product" &&
      response.ok(),
  );
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await snapshot;
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "What should your next tool do?",
      exact: true,
    }),
  ).toBeVisible();
}

try {
  await guardRequests(context);
  const page = await context.newPage();
  observe(page);
  const healthResponse = await context.request.get(base + "/api/health");
  assert.equal(healthResponse.status(), 200);
  const health = await healthResponse.json();
  assert.equal(health.freeOnly, true);
  assert.equal(health.interactiveCompiler.provider, "ollama-local");
  evidence.health = health;
  const routes = [
    { name: "home", path: "/", heading: "What should your next tool do?" },
    { name: "tools", path: "/tools", heading: "Your tools" },
    { name: "activity", path: "/activity", heading: "Activity" },
    { name: "inspect", path: "/inspect", heading: "Inspect FORGE" },
    { name: "twin", path: "/twin", heading: "Northbank" },
  ];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const size = viewport.width === 1440 ? "desktop" : "mobile";
    for (const route of routes) {
      const ready = page.waitForResponse((response) => {
        const path = new URL(response.url()).pathname;
        return (
          response.ok() &&
          response.request().method() === "GET" &&
          path === (route.name === "twin" ? "/api/environment" : "/api/product")
        );
      });
      const response = await page.goto(base + route.path, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 200);
      await ready;
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: route.heading,
          exact: true,
        }),
      ).toBeVisible();
      if (route.name === "twin")
        await expect(page.locator("canvas")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      const image = await screenshot(page, `${route.name}-${size}`);
      pages.push({
        name: route.name,
        route: route.path,
        viewport,
        heading: route.heading,
        geometry,
        horizontalOverflow: geometry.documentWidth > geometry.viewportWidth,
        screenshot: image,
      });
      assert(
        geometry.documentWidth <= geometry.viewportWidth,
        `${route.name} ${size} has horizontal overflow`,
      );
      await expect(page.locator(".product-error[role=alert]")).toHaveCount(0);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  // Keep this browser-owned source literal: tsx's function-name helpers do not
  // exist in a page's separate JavaScript realm.
  await page.addInitScript({
    content: String.raw`(() => {
    let active;
    const harness = {
      mode: "success",
      mediaRequests: 0,
      tracksStopped: 0,
      constructions: 0,
      starts: 0,
      stops: 0,
      aborts: 0,
      emit(texts, final) {
        active?.onresult?.({
          results: texts.map((transcript) => ({
            isFinal: final,
            0: { transcript },
          })),
        });
      },
    };
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart = null;
      onresult = null;
      onerror = null;
      onend = null;
      constructor() {
        active = this;
        harness.constructions++;
      }
      start() {
        harness.starts++;
        this.onstart?.();
      }
      stop() {
        harness.stops++;
        this.onend?.();
      }
      abort() {
        harness.aborts++;
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        harness.mediaRequests++;
        if (harness.mode === "denied")
          throw new DOMException(
            "Injected permission denial",
            "NotAllowedError",
          );
        return { getTracks: () => [{ stop: () => harness.tracksStopped++ }] };
      },
    });
    window.productionVoiceHarness = harness;
  })();`,
  });
  await loadedHome(page);
  const draft = page.getByRole("textbox", {
    name: "Tell FORGE what you want",
    exact: true,
  });
  const ask = page.getByRole("button", { name: "Ask FORGE", exact: true });
  await draft.fill("Please");
  await expect(ask).toBeEnabled();
  await page
    .getByRole("button", { name: "Start voice input", exact: true })
    .click();
  await expect(
    page.getByText("Listening. Speak your goal, then press Stop.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop voice input", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(ask).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as VoiceWindow).productionVoiceHarness.emit(
      ["summarize these rows"],
      false,
    ),
  );
  await expect(draft).toHaveValue("Please summarize these rows");
  await page.evaluate(() =>
    (window as unknown as VoiceWindow).productionVoiceHarness.emit(
      ["summarize these rows", "and save a local report"],
      true,
    ),
  );
  const expectedDraft = "Please summarize these rows and save a local report";
  await expect(draft).toHaveValue(expectedDraft);
  await expect(ask).toBeDisabled();
  voice.listeningScreenshot = await screenshot(page, "home-voice-listening");
  await page
    .getByRole("button", { name: "Stop voice input", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start voice input", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(ask).toBeEnabled();
  await expect(draft).toHaveValue(expectedDraft);
  await page.evaluate(() =>
    (window as unknown as VoiceWindow).productionVoiceHarness.emit(
      ["late text must be ignored"],
      true,
    ),
  );
  await expect(draft).toHaveValue(expectedDraft);
  const successCounters = await page.evaluate(() => {
    const {
      mode,
      mediaRequests,
      tracksStopped,
      constructions,
      starts,
      stops,
      aborts,
    } = (window as unknown as VoiceWindow).productionVoiceHarness;
    return {
      mode,
      mediaRequests,
      tracksStopped,
      constructions,
      starts,
      stops,
      aborts,
    };
  });
  assert.equal(successCounters.mediaRequests, 1);
  assert.equal(successCounters.tracksStopped, 1);
  assert.equal(successCounters.starts, 1);
  assert.equal(successCounters.stops, 1);
  assert(successCounters.aborts >= 1);
  voice.success = {
    expectedDraft,
    askDisabledWhileListening: true,
    askEnabledAfterStop: true,
    lateSpeechIgnored: true,
    counters: successCounters,
  };
  voice.stoppedScreenshot = await screenshot(page, "home-voice-stopped");
  await page.evaluate(() => {
    (window as unknown as VoiceWindow).productionVoiceHarness.mode = "denied";
  });
  const preservedDraft = "Keep this typed draft after permission denial";
  await draft.fill(preservedDraft);
  await page
    .getByRole("button", { name: "Start voice input", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Allow microphone access for this site" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start voice input", exact: true }),
  ).toBeEnabled();
  await expect(draft).toHaveValue(preservedDraft);
  await expect(ask).toBeEnabled();
  const denialCounters = await page.evaluate(() => {
    const { mediaRequests, tracksStopped, constructions, starts } = (
      window as unknown as VoiceWindow
    ).productionVoiceHarness;
    return { mediaRequests, tracksStopped, constructions, starts };
  });
  assert.equal(denialCounters.mediaRequests, 2);
  assert.equal(denialCounters.tracksStopped, 1);
  assert.equal(denialCounters.constructions, 1);
  voice.permissionDenial = {
    preservedDraft,
    draftPreserved: true,
    recognizerNotStarted: true,
    counters: denialCounters,
  };
  voice.deniedScreenshot = await screenshot(page, "home-voice-denied");
  await page.close();
  assert.deepEqual(pageErrors, [], "Browser JavaScript errors were reported");
  assert.deepEqual(apiErrors, [], "Unexpected API errors were reported");
  assert.deepEqual(
    requestFailures,
    [],
    "Unexpected request failures were reported",
  );
  assert.deepEqual(
    prohibitedRequests,
    [],
    "A prohibited request was attempted",
  );
  // The transport's unsupported GET probe can emit a browser console message.
  const unexpectedConsole = consoleErrors.filter(
    (message) => !/405.*Method Not Allowed|status of 405/.test(message),
  );
  assert.deepEqual(
    unexpectedConsole,
    [],
    "Unexpected browser console errors were reported",
  );
  voice.passed = true;
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  voice.error = evidence.error;
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  evidence.durationMs = performance.now() - started;
  await writeFile(voiceOutput, JSON.stringify(voice, null, 2) + "\n");
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify({
      passed: evidence.passed,
      pages: pages.length,
      proof: output,
      voiceProof: voiceOutput,
      error: evidence.error,
    }),
  );
}
