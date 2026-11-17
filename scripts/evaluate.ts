import { readFile, mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { compile } from "../src/forge/compiler";
import { DemoModelProvider } from "../src/forge/models";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { scoutRequest, postings } from "../src/forge/fixtures";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { PermissionBroker } from "../src/forge/broker";
import { digest } from "../src/forge/hash";
import { boundaryCasesSchema, evaluateBoundaries } from "./evaluate-boundaries";
const boundaryCases = boundaryCasesSchema.parse(
  JSON.parse(await readFile("evaluation/boundaries.json", "utf8")),
);
const scenarios = z
  .array(
    z.object({
      id: z.string(),
      request: z.string(),
      seed: z.boolean().optional(),
      fixture: z.enum(["amd", "irrelevant", "hostile"]).optional(),
      attack: z.boolean().optional(),
      blocked: z.boolean().optional(),
      resolution: z.string().optional(),
      permissions: z.array(z.string()).optional(),
    }),
  )
  .parse(JSON.parse(await readFile("evaluation/scenarios.json", "utf8")));
type Result = {
  id: string;
  passed: boolean;
  latencyMs: number;
  resolution?: string;
  installed?: boolean;
  registered?: boolean;
  invoked?: boolean;
  schemaValid?: boolean;
  overPermissions: string[];
  underPermissions: string[];
  checksPassed?: number;
  checksTotal?: number;
  attackBlocked?: boolean;
  reusedNodes?: number;
  error?: string;
};
const results: Result[] = [];
for (const scenario of scenarios) {
  const start = performance.now();
  const service = new ForgeService(new MemoryStateStore());
  const result: Result = {
    id: scenario.id,
    passed: false,
    latencyMs: 0,
    overPermissions: [],
    underPermissions: [],
  };
  try {
    if (scenario.seed) {
      const seed = await service.propose(scoutRequest);
      await service.approve(
        seed.definition.id,
        seed.definition.version,
        seed.digest,
      );
    }
    const installed = (await service.store.read()).releases
      .filter((r) => r.status === "installed")
      .map((r) => r.definition);
    const compilation = await compile(
      scenario.request,
      installed,
      new DemoModelProvider(),
    );
    if (scenario.blocked)
      throw new Error("Forbidden request unexpectedly compiled");
    result.resolution = compilation.resolution;
    result.schemaValid = true;
    result.reusedNodes = compilation.reusedNodes.length;
    result.overPermissions = compilation.definition.permissions.filter(
      (p) => !scenario.permissions?.includes(p),
    );
    result.underPermissions =
      scenario.permissions?.filter(
        (p) =>
          !compilation.definition.permissions.includes(
            p as (typeof compilation.definition.permissions)[number],
          ),
      ) ?? [];
    const release = await service.propose(scenario.request);
    result.checksPassed = release.report.checks.filter((c) => c.passed).length;
    result.checksTotal = release.report.checks.length;
    if (release.status !== "installed")
      await service.approve(
        release.definition.id,
        release.definition.version,
        release.digest,
      );
    result.installed = true;
    const { server } = await createForgeMcpServer(service);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "frozen-evaluation", version: "1" });
    await server.connect(st);
    await client.connect(ct);
    try {
      const cap = release.definition;
      const career = cap.trigger === "new_job_posting";
      result.registered = (await client.listTools()).tools.some(
        (tool) => tool.name === cap.toolContract.name,
      );
      const args = career
        ? {
            eventId: scenario.id,
            jobPosting: postings[scenario.fixture ?? "amd"],
          }
        : {
            eventId: scenario.id,
            text: "School projects are due Friday. The picnic is Saturday. Bring water.",
          };
      const invocation = await client.callTool({
        name: cap.toolContract.name,
        arguments: args,
      });
      result.invoked = invocation.isError !== true;
      if (scenario.attack) {
        const broker = new PermissionBroker(
          cap,
          {
            id: "attack",
            type: cap.trigger,
            payload: { posting: postings.hostile },
          },
          service.store,
        );
        try {
          await broker.invoke(cap.nodes[0].id, "external_http.write");
          result.attackBlocked = false;
        } catch {
          result.attackBlocked = broker.permissionDenials === 1;
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
    result.passed =
      result.resolution === scenario.resolution &&
      !result.overPermissions.length &&
      !result.underPermissions.length &&
      result.invoked === true &&
      result.registered === true &&
      release.report.passed &&
      (!scenario.attack || result.attackBlocked === true);
  } catch (e) {
    result.error = e instanceof Error ? e.message : "Evaluation failed";
    result.passed =
      scenario.blocked === true && /forbidden primitive/.test(result.error);
    if (scenario.blocked) result.attackBlocked = result.passed;
  }
  result.latencyMs = Math.round(performance.now() - start);
  results.push(result);
}
const supported = results.filter((r) => r.schemaValid);
const attacks = results.filter((r) => r.attackBlocked !== undefined);
const boundaryResults = await evaluateBoundaries(boundaryCases);
const ratio = (passed: number, total: number) => ({ passed, total });
const supportedScenarios = scenarios.filter((s) => !s.blocked);
const classification = Object.fromEntries(
  ["EXACT_MATCH", "COMPOSE", "EXTEND", "SYNTHESIZE"].map((kind) => {
    const expected = supportedScenarios.filter((s) => s.resolution === kind);
    return [
      kind,
      ratio(
        results.filter(
          (r) => expected.some((s) => s.id === r.id) && r.resolution === kind,
        ).length,
        expected.length,
      ),
    ];
  }),
);
const boundaryCategories = Object.fromEntries(
  [...new Set(boundaryCases.map((s) => s.category))].map((category) => {
    const cases = boundaryResults.filter((r) => r.category === category);
    return [
      category,
      ratio(cases.filter((r) => r.passed).length, cases.length),
    ];
  }),
);
const report = {
  generatedAt: new Date().toISOString(),
  suiteDigest: digest({ scenarios, boundaryCases }),
  provider: "deterministic-planner",
  externalData: "fixtures",
  transport:
    "Official MCP SDK linked in-memory transports; HTTP proof reported separately",
  scenarios: results.length + boundaryResults.length,
  passed:
    results.filter((r) => r.passed).length +
    boundaryResults.filter((r) => r.passed).length,
  categories: {
    installation: ratio(
      results.filter((r) => r.installed).length,
      supportedScenarios.length,
    ),
    mcpRegistration: ratio(
      results.filter((r) => r.registered).length,
      supportedScenarios.length,
    ),
    mcpInvocation: ratio(
      results.filter((r) => r.invoked).length,
      supportedScenarios.length,
    ),
    requestSchemaValidity: ratio(supported.length, supportedScenarios.length),
    exactPermissions: ratio(
      supported.filter(
        (r) => !r.overPermissions.length && !r.underPermissions.length,
      ).length,
      supportedScenarios.length,
    ),
    installedExecutionSuccess: ratio(
      results.filter((r) => r.installed && r.invoked).length,
      supportedScenarios.length,
    ),
    forbiddenRequests: ratio(
      results.filter(
        (r) => scenarios.find((s) => s.id === r.id)?.blocked && r.passed,
      ).length,
      scenarios.filter((s) => s.blocked).length,
    ),
    ...boundaryCategories,
    promptInjection: ratio(
      boundaryResults.filter(
        (r) => r.category === "promptInjection" && r.passed,
      ).length +
        results.filter(
          (r) =>
            scenarios.find((s) => s.id === r.id)?.attack && r.attackBlocked,
        ).length,
      boundaryCases.filter((s) => s.category === "promptInjection").length +
        scenarios.filter((s) => s.attack).length,
    ),
    classification,
  },
  metrics: {
    schemaValidity: `${supported.length}/${scenarios.filter((s) => !s.blocked).length}`,
    installedAndInvoked: `${results.filter((r) => r.installed && r.invoked).length}/${supported.length}`,
    overPermissionCount: results.reduce(
      (a, r) => a + r.overPermissions.length,
      0,
    ),
    underPermissionCount: results.reduce(
      (a, r) => a + r.underPermissions.length,
      0,
    ),
    designatedAttackBlockRate: `${attacks.filter((r) => r.attackBlocked).length + boundaryResults.filter((r) => r.category === "promptInjection" && r.passed).length}/${attacks.length + boundaryCases.filter((s) => s.category === "promptInjection").length}`,
    executableChecks: `${results.reduce((a, r) => a + (r.checksPassed ?? 0), 0)}/${results.reduce((a, r) => a + (r.checksTotal ?? 0), 0)}`,
    compositionReuseNodes: results.reduce(
      (a, r) => a + (r.reusedNodes ?? 0),
      0,
    ),
    estimatedModelCost: 0,
  },
  results,
  boundaryResults,
};
await mkdir("evaluation", { recursive: true });
await writeFile("evaluation/latest.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    { ...report, results: undefined, boundaryResults: undefined },
    null,
    2,
  ),
);
if (report.passed !== report.scenarios) process.exitCode = 1;
