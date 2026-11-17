import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { releaseSchema, executionSchema } from "../src/forge/records";
import {
  scoutRequest,
  extensionRequest,
  postings,
} from "../src/forge/fixtures";
const prefix = process.env.FORGE_PROOF_PREFIX;
assert(!prefix || /^[a-z0-9-]{1,40}$/.test(prefix), "Invalid proof prefix");
const proofFile =
  "artifacts/" + (prefix ? prefix + "-" : "") + "http-proof.json";
const origin = new URL(process.env.FORGE_VERIFY_URL ?? "http://127.0.0.1:3108");
assert(
  ["127.0.0.1", "localhost"].includes(origin.hostname),
  "Automated approval harness is restricted to a fresh loopback test server",
);
const client = new Client({
  name: "FORGE packaged-app verification",
  version: "1",
});
const authHeaders: Record<string, string> = process.env.FORGE_API_TOKEN
  ? { Authorization: `Bearer ${process.env.FORGE_API_TOKEN}` }
  : {};
await mkdir("artifacts", { recursive: true });
await writeFile(
  proofFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      passed: false,
      status: "Verification started; incomplete until all checks pass",
      nativeAlexaClientVerified: false,
    },
    null,
    2,
  ),
);
let authenticationStatusVerified = false;
if (process.env.FORGE_API_TOKEN) {
  for (const method of ["GET", "POST"]) {
    const unauthenticated = await fetch(new URL("/api/mcp", origin), {
      method,
    });
    assert.equal(unauthenticated.status, 401);
    assert(!unauthenticated.headers.has("www-authenticate"));
  }
  const forbiddenOrigin = await fetch(new URL("/api/mcp", origin), {
    method: "POST",
    headers: { ...authHeaders, Origin: "https://attacker.example" },
  });
  assert.equal(forbiddenOrigin.status, 403);
  authenticationStatusVerified = true;
}
async function profileRpc(
  method: string,
  params: unknown,
  id: number | string,
) {
  const response = await fetch(new URL("/api/mcp", origin), {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(method === "initialize"
        ? {}
        : { "MCP-Protocol-Version": "2025-11-25" }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert(response.ok, `MCP 2025-11-25 protocol: HTTP ${response.status}`);
  const envelope = await response.json();
  assert.equal(envelope.jsonrpc, "2.0");
  assert.equal(envelope.id, id);
  assert(!envelope.error, JSON.stringify(envelope.error));
  return envelope.result;
}
const initialized = await profileRpc(
  "initialize",
  {
    protocolVersion: "2025-11-25",
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: "FORGE open-protocol verification", version: "1" },
  },
  "init-2025-11-25",
);
assert.equal(initialized.protocolVersion, "2025-11-25");
assert.equal(initialized.capabilities.tools.listChanged, false);
const protocolChecks: string[] = [
  "initialization/version/capabilities/string request ID",
];
for (const [body, status, code] of [
  ["{", 400, -32700],
  [
    JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]),
    400,
    -32600,
  ],
  [
    JSON.stringify({ jsonrpc: "1.0", id: "invalid", method: "tools/list" }),
    400,
    -32600,
  ],
  [
    JSON.stringify({ jsonrpc: "2.0", id: "unknown", method: "unknown/method" }),
    200,
    -32601,
  ],
] as const) {
  const response = await fetch(new URL("/api/mcp", origin), {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body,
  });
  assert.equal(response.status, status);
  const error = await response.json();
  assert.equal(error.error.code, code);
  if (code === -32601) assert.equal(error.id, "unknown");
  protocolChecks.push(`HTTP ${status}; JSON-RPC ${code}`);
}
const notification = await fetch(new URL("/api/mcp", origin), {
  method: "POST",
  headers: {
    ...authHeaders,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});
assert.equal(notification.status, 202);
assert.equal(await notification.text(), "");
assert(!notification.headers.has("mcp-session-id"));
assert.equal(
  (await fetch(new URL("/api/mcp", origin), { headers: authHeaders })).status,
  405,
);
protocolChecks.push("notification 202 empty; no session; GET 405");
await client.connect(
  new StreamableHTTPClientTransport(new URL("/api/mcp", origin), {
    requestInit: { headers: authHeaders },
  }),
);
try {
  const before = await client.listTools();
  const profileBefore = await profileRpc("tools/list", {}, 2);
  assert.deepEqual(
    profileBefore.tools.map((tool: { name: string }) => tool.name),
    before.tools.map((tool) => tool.name),
  );
  assert(
    !before.tools.some((t) => t.name === "internship_scout"),
    "Requires fresh test state; refusing to modify an existing Internship Scout",
  );
  const build = async (request: string) => {
    const response = await client.callTool(
      { name: "forge.build", arguments: { request } },
      undefined,
      { timeout: 120000 },
    );
    assert(!response.isError);
    const blocks = response.content as Array<{ type: string; text?: string }>;
    return releaseSchema.parse(
      JSON.parse(blocks.find((b) => b.type === "text")!.text!),
    );
  };
  const approve = async (release: ReturnType<typeof releaseSchema.parse>) => {
    const response = await fetch(new URL("/api/forge", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        action: "approve",
        id: release.definition.id,
        version: release.definition.version,
        digest: release.digest,
      }),
    });
    assert(response.ok, await response.text());
  };
  const release = await build(scoutRequest);
  assert(release.report.passed);
  assert(
    !(await client.listTools()).tools.some(
      (tool) => tool.name === "internship_scout",
    ),
    "Proposal must remain undiscoverable until approval",
  );
  await approve(release);
  const after = await client.listTools();
  assert(after.tools.some((t) => t.name === "internship_scout"));
  const profileAfter = await profileRpc("tools/list", {}, 3);
  assert(
    profileAfter.tools.some(
      (tool: { name: string }) => tool.name === "internship_scout",
    ),
  );
  const profileCall = await profileRpc(
    "tools/call",
    {
      name: "internship_scout",
      arguments: {
        eventId: "documented-profile-proof",
        jobPosting: postings.amd,
      },
    },
    4,
  );
  assert.equal(
    executionSchema.parse(profileCall.structuredContent).status,
    "success",
  );
  const result = await client.callTool({
    name: "internship_scout",
    arguments: { eventId: "packaged-proof-v1", jobPosting: postings.amd },
  });
  const run = executionSchema.parse(result.structuredContent);
  assert.equal(run.status, "success");
  assert.equal(run.trace.length, 6);
  const extension = await build(extensionRequest);
  assert.equal(extension.definition.version, "1.1.0");
  await approve(extension);
  const updated = await client.listTools();
  assert(
    updated.tools
      .find((t) => t.name === "internship_scout")
      ?.description?.includes("1.1.0"),
  );
  const second = await client.callTool({
    name: "internship_scout",
    arguments: { eventId: "packaged-proof-v2", jobPosting: postings.amd },
  });
  const patchedRun = executionSchema.parse(second.structuredContent);
  assert.equal(patchedRun.status, "success");
  assert.equal(patchedRun.trace.length, 8);
  const rollback = await fetch(new URL("/api/forge", origin), {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "rollback",
      id: release.definition.id,
      version: "1.0.0",
    }),
  });
  assert(rollback.ok, await rollback.text());
  assert(
    (await client.listTools()).tools
      .find((tool) => tool.name === "internship_scout")
      ?.description?.includes("1.0.0"),
  );
  const rollbackCall = await client.callTool({
    name: "internship_scout",
    arguments: { eventId: "rollback-proof", jobPosting: postings.amd },
  });
  const rollbackRun = executionSchema.parse(rollbackCall.structuredContent);
  assert.equal(rollbackRun.version, "1.0.0");
  assert.equal(rollbackRun.trace.length, 6);
  const proof = {
    generatedAt: new Date().toISOString(),
    passed: true,
    client: "Official MCP SDK plus explicit 2025-11-25 wire requests",
    nativeAlexaClientVerified: false,
    authenticationStatusVerified,
    protocolVersion: initialized.protocolVersion,
    protocolChecks,
    transport: "Streamable HTTP",
    approval: "isolated automated loopback test harness",
    before: before.tools.map((t) => t.name),
    after: after.tools.map((t) => t.name),
    checks: release.report.checks.length,
    invocation: run.status,
    traceSteps: run.trace.length,
    extension: patchedRun.version,
    extensionTraceSteps: patchedRun.trace.length,
    rollbackVersion: rollbackRun.version,
    rollbackTraceSteps: rollbackRun.trace.length,
    sandbox: patchedRun.sandbox,
    compilation: release.usage,
    attack: release.report.checks.find((check) => check.evidence)?.evidence,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(proofFile, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await client.close();
}
