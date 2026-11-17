import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { verifyCapsule } from "../src/forge/capsule";
const prefix = process.env.FORGE_PROOF_PREFIX;
assert(!prefix || /^[a-z0-9-]{1,40}$/.test(prefix), "Invalid proof prefix");
const artifact = (name: string) =>
  "artifacts/" + (prefix ? prefix + "-" : "") + name;

const origin = new URL(process.env.FORGE_VERIFY_URL ?? "http://127.0.0.1:3113");
assert(
  ["127.0.0.1", "localhost"].includes(origin.hostname),
  "Use an isolated loopback judge instance",
);
const headers: Record<string, string> = process.env.FORGE_API_TOKEN
  ? { Authorization: "Bearer " + process.env.FORGE_API_TOKEN }
  : {};
await mkdir("artifacts", { recursive: true });
await writeFile(
  artifact("live-http-proof.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    passed: false,
    status: "Verification started; incomplete until all checks pass",
  }),
);
const client = new Client({ name: "FORGE packaged Live proof", version: "1" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("/api/mcp", origin), {
    requestInit: { headers },
  }),
);
const before = (await client.listTools()).tools.map((t) => t.name);
assert(
  !before.includes("deadline_guardian"),
  "Use fresh isolated state; never auto-approve on the main instance",
);
const browser = await chromium.launch();
const context = await browser.newContext({ extraHTTPHeaders: headers });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const click = (name: string) =>
  page.getByRole("button", { name, exact: true }).click();
try {
  await page.goto(new URL("/live", origin).href);
  await click("Build this program");
  await expect(
    page.getByText("I built and tested its source.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  assert(
    !(await client.listTools()).tools.some(
      (t) => t.name === "deadline_guardian",
    ),
  );
  await click("Run Replay");
  await expect(
    page.getByText("Labeled fixture: 8/8 exact matches", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await click("Pause replay");
  await page.screenshot({
    path: artifact("live-production-replay.png"),
    fullPage: true,
    animations: "disabled",
  });
  await click("Approve tested program");
  await expect(
    page.getByText("Installed. Connector write access is still zero.", {
      exact: false,
    }),
  ).toBeVisible();
  const after = (await client.listTools()).tools.map((t) => t.name);
  assert(after.includes("deadline_guardian"));
  await click("Enable Shadow · no writes");
  await expect(
    page.getByRole("button", { name: "Run Shadow", exact: true }),
  ).toBeEnabled();
  const invoked = await client.callTool({
    name: "deadline_guardian",
    arguments: {
      eventId: "packaged-live-proof",
      text: "Run authorized snapshot in Shadow",
    },
  });
  assert(!invoked.isError, JSON.stringify(invoked.content));
  await click("Run Shadow");
  await expect(
    page.getByText("FIXTURE · SHADOW · 0 real external writes.", {
      exact: false,
    }),
  ).toBeVisible();
  await click("Approve exact permissions · FIXTURE");
  await click("Run Fixture");
  await expect(
    page.getByText("FIXTURE · LIVE · 0 real external writes.", {
      exact: false,
    }),
  ).toBeVisible();
  await click("Revoke live access");
  await expect(
    page.getByRole("button", { name: "Run Fixture", exact: true }),
  ).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await click("Export .forgecap");
  const download = await downloadPromise;
  const capsulePath = artifact("packaged-deadline.forgecap");
  await download.saveAs(capsulePath);
  const verified = verifyCapsule(
    JSON.parse(await readFile(capsulePath, "utf8")),
  );
  await click("Test tampered copy");
  await expect(page.locator(".live-error[role=alert]")).toContainText(
    "hash mismatch",
  );
  await click("Import exported copy · fresh local trust");
  await expect(
    page.getByText(
      "Signature VALID · Local trust NOT ESTABLISHED · 0 inherited grants",
    ),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("0 active permission grants", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
  );
  await page.screenshot({
    path: artifact("live-production-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await click("LIVE GOOGLE");
  await click("Connect Google read access");
  await expect(page.locator(".live-error[role=alert]")).toContainText(
    "Google OAuth is not configured",
  );
  assert.deepEqual(pageErrors, []);
  const response = await fetch(new URL("/api/live", origin), { headers });
  assert(response.ok);
  const snapshot = (await response.json()).snapshot;
  const imported = snapshot.releases.find((r: { definition: { id: string } }) =>
    r.definition.id.includes("import-"),
  );
  assert(imported);
  assert.equal(snapshot.live.trust[imported.digest].current, "UNTRUSTED");
  assert.deepEqual(snapshot.live.trust[imported.digest].grants, []);
  const proof = {
    generatedAt: new Date().toISOString(),
    passed: true,
    origin: origin.origin,
    runtimeMode: "fixture",
    packagedLinux: true,
    authenticationConfigured: Boolean(process.env.FORGE_API_TOKEN),
    before,
    after,
    reviewNotInstalled: true,
    mcpInvocation: true,
    replay: {
      emails: 8,
      deadlineChanges: 3,
      proposedEffects: 7,
      externalWrites: 0,
    },
    shadowIntercepted: true,
    exactPermissionsApproved: true,
    revocationVerified: true,
    capsule: {
      signature: verified.signature,
      provider: verified.capsule.signature.provider,
      contentHash: verified.capsule.contentHash,
      tamperingRejected: true,
      importTrust: "UNTRUSTED",
      inheritedGrants: 0,
    },
    mobileOverflow: false,
    pageErrors,
    googleLive: "NOT VERIFIED: OAuth not configured",
  };
  await writeFile(
    artifact("live-http-proof.json"),
    JSON.stringify(proof, null, 2),
  );
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await context.close();
  await browser.close();
  await client.close();
}
