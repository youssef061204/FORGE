import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { GoalResult } from "../src/forge/product/runtime";
import type { ProgramRun } from "../src/forge/product/contracts";
import { freeOnlyEnabled } from "../src/forge/cost-policy";

assert(freeOnlyEnabled(), "Production proof requires free-only policy");
const base = "http://127.0.0.1:3108";
const restart = process.argv.includes("--restart-proof");
assert(
  process.argv.slice(2).every((flag) => flag === "--restart-proof"),
  "Unknown proof option",
);
const dir = "artifacts/local-synthesis";
await mkdir(dir, { recursive: true });
const label = restart ? "production-restart" : "production";
const started = performance.now();
const eventId = label + "-" + Date.now();
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (process.env.FORGE_API_TOKEN)
  headers.Authorization = "Bearer " + process.env.FORGE_API_TOKEN;
const expected = { Notebook: 20, Pen: 12, Lamp: 75 };
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, {
    headers,
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(
    response.status,
    200,
    "Owner API failed; response contents omitted",
  );
  return response;
}
function content<T>(response: Awaited<ReturnType<Client["callTool"]>>): T {
  assert(
    !response.isError,
    "MCP returned a tool error; no success is recorded",
  );
  const text = (response.content as Array<{ text?: string }>).find(
    (part) => part.text,
  )?.text;
  assert(text, "Expected MCP JSON result");
  return JSON.parse(text) as T;
}
const client = new Client({
  name: "forge-free-production-proof",
  version: "1",
});
try {
  const health = await (await api("/api/health")).json();
  assert.equal(health.freeOnly, true);
  assert.equal(health.runtimeMode, "fixture");
  assert.equal(health.interactiveCompiler.provider, "ollama-local");
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
      requestInit: { headers },
    }),
  );
  const t0 = (await client.listTools()).tools.map((tool) => tool.name);
  let id: string, name: string, hash: string, compiler: unknown;
  if (restart) {
    const prior = JSON.parse(
      await readFile(dir + "/production-proof.json", "utf8"),
    );
    id = prior.tool.id;
    name = prior.installedTool;
    hash = prior.tool.hash;
    assert(t0.includes(name), "Approved tool did not survive process restart");
  } else {
    const inputName = "proof-orders-" + Date.now() + ".csv";
    const outputName = "proof-totals.json";
    const uploaded = await (
      await api("/api/product", {
        action: "upload",
        name: inputName,
        format: "csv",
        text: "item,quantity,price\nNotebook,4,5\nPen,6,2\nLamp,3,25\n",
      })
    ).json();
    const result = content<GoalResult>(
      await client.callTool(
        {
          name: "forge.build",
          arguments: {
            request: `Read ${inputName} and save ${outputName} containing a JSON object mapping each item name to quantity times price as numbers. Compute the values from the rows; include every item.`,
          },
        },
        undefined,
        { timeout: 900000 },
      ),
    );
    assert.equal(result.state, "review");
    assert(result.tool, "Actual compiler did not return software");
    const tool = result.tool;
    assert.equal(tool.usage.provider, "ollama-local");
    assert.equal(tool.usage.schemaValidated, true);
    assert.equal(tool.evidence.passed, true);
    assert.equal(tool.evidence.replay.externalWrites, 0);
    assert.deepEqual(tool.grants, []);
    assert.deepEqual(
      [...tool.permissions].sort(),
      [`workspace.${uploaded.id}.read`, "workspace.outputs.write"].sort(),
    );
    assert.deepEqual(tool.actions, ["workspace.save"]);
    id = tool.id;
    name = "tool_" + id.replaceAll("-", "_");
    hash = tool.hash;
    assert(!t0.includes(name), "New software was already present at T0");
    assert(
      !(await client.listTools()).tools.some((entry) => entry.name === name),
      "Unapproved software was exposed through MCP",
    );
    await api("/api/product", {
      action: "approve",
      id,
      hash,
      permissions: tool.permissions,
    });
    compiler = {
      version: tool.version,
      source: tool.source,
      tests: tool.tests,
      permissions: tool.permissions,
      usage: tool.usage,
      evidence: tool.evidence,
    };
  }
  const t1 = (await client.listTools()).tools.map((tool) => tool.name);
  assert(t1.includes(name), "Approved tool not discoverable");
  const run = content<ProgramRun>(
    await client.callTool({ name, arguments: { eventId } }, undefined, {
      timeout: 30000,
    }),
  );
  assert.equal(run.status, "done");
  assert.equal(run.receipts.length, 1);
  const receipt = run.receipts[0];
  assert.equal(receipt.operation, "workspace.save");
  assert.equal(receipt.status, "committed");
  assert(receipt.responseId);
  const download = await api(
    "/api/product?artifact=" + encodeURIComponent(receipt.responseId),
  );
  assert(download.headers.get("content-disposition")?.includes("attachment"));
  const bytes = await download.text();
  assert.deepEqual(JSON.parse(bytes), expected);
  const repeat = content<ProgramRun>(
    await client.callTool({ name, arguments: { eventId } }),
  );
  assert.equal(repeat.status, "ignored");
  const report = {
    at: new Date().toISOString(),
    passed: true,
    base,
    processRestartVerified: restart,
    paidRequests: 0,
    health,
    t0,
    t1,
    installedTool: name,
    tool: { id, hash, ...((compiler as object) ?? {}) },
    run,
    duplicateEventIgnored: true,
    output: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      actual: JSON.parse(bytes),
      expected,
    },
    durationMs: performance.now() - started,
  };
  await writeFile(
    dir + "/" + label + "-proof.json",
    JSON.stringify(report, null, 2),
  );
  await writeFile(dir + "/" + label + "-download.json", bytes);
  console.log(
    JSON.stringify({
      passed: true,
      proof: dir + "/" + label + "-proof.json",
      id,
      processRestartVerified: restart,
      durationMs: report.durationMs,
      paidRequests: 0,
    }),
  );
} catch (error) {
  await writeFile(
    dir + "/" + label + "-failure-" + Date.now() + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: false,
        paidRequests: 0,
        durationMs: performance.now() - started,
        error: error instanceof Error ? error.message : "Proof failed",
      },
      null,
      2,
    ),
  );
  console.error(
    "Production proof failed; see retained failure artifact. No success recorded.",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
