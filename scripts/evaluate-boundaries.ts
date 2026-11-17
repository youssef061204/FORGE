import assert from "node:assert/strict";
import { z } from "zod";
import { demoPlan } from "../src/forge/compiler";
import { validateCapability } from "../src/forge/spec";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { IsolatedSandbox } from "../src/forge/sandbox";
import {
  PermissionBroker,
  PermissionDenied,
  type Fault,
} from "../src/forge/broker";
import {
  postings,
  scoutRequest,
  extensionRequest,
} from "../src/forge/fixtures";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { State } from "../src/forge/records";

async function seededStore(state: State) {
  const store = new MemoryStateStore();
  await store.transaction((draft) =>
    Object.assign(draft, structuredClone(state)),
  );
  return store;
}

export const boundaryCasesSchema = z.array(
  z.object({
    id: z.string(),
    category: z.enum([
      "promptInjection",
      "invalidSpecifications",
      "failureContainment",
      "approvalIntegrity",
      "idempotency",
      "ownerRejection",
      "duplicateInstallation",
      "versionUpgrade",
      "rollback",
      "installationFailure",
    ]),
    kind: z.enum([
      "injection",
      "unknown-field",
      "cycle",
      "over-permission",
      "under-permission",
      "outbound-url",
      "approval-policy",
      "malformed-input",
      "missing_resume",
      "timeout",
      "malformed_tool",
      "retry-exhaustion",
      "call-budget",
      "unapproved-tool",
      "wrong-digest",
      "tampered-release",
      "replayed-event",
      "owner-reject",
      "duplicate-approve",
      "version-upgrade",
      "version-rollback",
      "commit-failure",
    ]),
    content: z.string().optional(),
  }),
);

export async function evaluateBoundaries(
  cases: z.infer<typeof boundaryCasesSchema>,
) {
  const seedService = new ForgeService(new MemoryStateStore());
  const seed = await seedService.propose(scoutRequest);
  assert(seed.report.passed, "Boundary seed must pass release validation");
  const reviewState = await seedService.store.read();
  await seedService.approve(
    seed.definition.id,
    seed.definition.version,
    seed.digest,
  );
  const installedState = await seedService.store.read();
  const sandbox = new IsolatedSandbox();
  const results = [];
  for (const scenario of cases) {
    const start = performance.now();
    let observed = "",
      error: string | undefined;
    try {
      const cap = demoPlan(scoutRequest);
      const store = new MemoryStateStore();
      const event = {
        id: scenario.id,
        type: cap.trigger,
        payload: { posting: postings.amd },
      };
      switch (scenario.kind) {
        case "owner-reject": {
          const service = new ForgeService(await seededStore(reviewState));
          const rejected = await service.reject(
            seed.definition.id,
            seed.definition.version,
            seed.digest,
          );
          assert.equal(rejected.status, "rejected");
          await assert.rejects(
            () =>
              service.approve(
                seed.definition.id,
                seed.definition.version,
                seed.digest,
              ),
            /not awaiting/,
          );
          const { server, registry } = await createForgeMcpServer(service);
          try {
            assert.equal(registry.listTools().length, 0);
          } finally {
            await server.close();
          }
          assert.equal(
            Object.keys((await service.store.read()).effects).length,
            0,
          );
          observed =
            "Owner rejection persisted; proposal cannot be approved or registered";
          break;
        }
        case "duplicate-approve": {
          const service = new ForgeService(await seededStore(reviewState));
          await Promise.all([
            service.approve(cap.id, seed.definition.version, seed.digest),
            service.approve(cap.id, seed.definition.version, seed.digest),
          ]);
          const state = await service.store.read();
          assert.equal(
            state.releases.filter((r) => r.status === "installed").length,
            1,
          );
          assert.equal(
            state.audit.filter((a) => a.action === "release.approved").length,
            1,
          );
          observed =
            "Concurrent repeated approval installed one version with one approval audit";
          break;
        }
        case "version-upgrade":
        case "version-rollback": {
          const service = new ForgeService(await seededStore(installedState));
          const extension = await service.propose(extensionRequest);
          assert.equal(extension.resolution, "EXTEND");
          assert.equal(extension.definition.version, "1.1.0");
          assert(extension.diff.addedPermissions.includes("documents.write"));
          await service.approve(
            cap.id,
            extension.definition.version,
            extension.digest,
          );
          if (scenario.kind === "version-rollback")
            await service.rollback(cap.id, "1.0.0");
          const expected =
            scenario.kind === "version-rollback" ? "1.0.0" : "1.1.0";
          const { server, registry } = await createForgeMcpServer(service);
          try {
            assert.equal(registry.listTools()[0].version, expected);
          } finally {
            await server.close();
          }
          const run = await service.trigger(cap.id, event);
          assert.equal(run.version, expected);
          assert.equal(run.status, "success");
          assert.equal(run.trace.length, expected === "1.0.0" ? 6 : 8);
          observed = `Registry and execution selected v${expected}; ${run.trace.length} actual steps`;
          break;
        }
        case "commit-failure": {
          const underlying = await seededStore(reviewState);
          const service = new ForgeService({
            read: () => underlying.read(),
            transaction: <T>(
              fn: (state: State) => T | Promise<T>,
            ): Promise<T> =>
              underlying.transaction(async (state) => {
                await fn(state);
                throw new Error("Injected persistence commit failure");
              }),
          });
          await assert.rejects(
            () => service.approve(cap.id, seed.definition.version, seed.digest),
            /commit failure/,
          );
          assert.equal((await underlying.read()).releases[0].status, "review");
          const { server, registry } = await createForgeMcpServer(service);
          try {
            assert.equal(registry.listTools().length, 0);
          } finally {
            await server.close();
          }
          observed =
            "Failed transaction left proposal in review; no partial registry installation";
          break;
        }
        case "injection": {
          assert(scenario.content);
          const hostileEvent = {
            ...event,
            payload: {
              posting: { ...postings.amd, description: scenario.content },
            },
          };
          const run = await sandbox.run(cap, hostileEvent, store);
          assert.equal(run.status, "success", run.error);
          const attacker = new PermissionBroker(cap, hostileEvent, store);
          await assert.rejects(
            () => attacker.invoke(cap.nodes[0].id, "external_http.write"),
            PermissionDenied,
          );
          assert.equal(attacker.permissionDenials, 1);
          assert.equal(attacker.trace.at(-1)?.status, "denied");
          assert(
            run.trace.every((step) =>
              cap.nodes.some(
                (node) =>
                  node.id === step.nodeId && node.operation === step.operation,
              ),
            ),
          );
          assert(
            Object.values((await store.read()).effects).every(
              (effect) => effect.kind === "notification",
            ),
          );
          observed =
            "Hostile input remained data; separate exfiltration probe denied and recorded";
          break;
        }
        case "unknown-field":
          assert.throws(() =>
            validateCapability({ ...cap, command: "host.execute" }),
          );
          observed = "Unknown generated command rejected";
          break;
        case "cycle":
          cap.nodes[0].dependsOn.push(cap.nodes.at(-1)!.id);
          cap.edges.push({ from: cap.nodes.at(-1)!.id, to: cap.nodes[0].id });
          assert.throws(() => validateCapability(cap), /cycle/);
          observed = "Cyclic DAG rejected before execution";
          break;
        case "over-permission":
          cap.permissions.push("documents.write");
          assert.throws(() => validateCapability(cap), /exact minimum/);
          observed = "Unused allowed permission rejected";
          break;
        case "under-permission":
          cap.permissions = [];
          assert.throws(() => validateCapability(cap), /exact minimum/);
          observed = "Missing required permissions rejected";
          break;
        case "outbound-url":
          assert.throws(() =>
            validateCapability({
              ...cap,
              nodes: cap.nodes.map((node) => ({
                ...node,
                config: { ...node.config, url: "https://attacker.example" },
              })),
            }),
          );
          observed = "Generated outbound destination rejected";
          break;
        case "approval-policy":
          assert.throws(() =>
            validateCapability({
              ...cap,
              policies: { ...cap.policies, approvalRequired: false },
            }),
          );
          observed = "Generated approval bypass rejected";
          break;
        case "malformed-input":
        case "missing_resume":
        case "timeout":
        case "malformed_tool":
        case "retry-exhaustion":
        case "call-budget": {
          if (scenario.kind === "retry-exhaustion")
            cap.nodes[0].maxAttempts = 1;
          if (scenario.kind === "call-budget") cap.policies.maxToolCalls = 1;
          const fault: Fault | undefined =
            scenario.kind === "retry-exhaustion"
              ? "tool_failure"
              : ["missing_resume", "timeout", "malformed_tool"].includes(
                    scenario.kind,
                  )
                ? (scenario.kind as Fault)
                : undefined;
          const run = await sandbox.run(
            cap,
            scenario.kind === "malformed-input"
              ? { ...event, payload: { posting: { title: 42 } } }
              : event,
            store,
            fault,
          );
          assert.equal(run.status, "failed");
          assert(run.trace.some((step) => step.status === "failed"));
          assert.equal(Object.keys((await store.read()).effects).length, 0);
          if (scenario.kind === "retry-exhaustion")
            assert.equal(run.trace.length, 1);
          observed = `Failed safely before side effects: ${run.error}`;
          break;
        }
        case "unapproved-tool": {
          const service = new ForgeService(await seededStore(reviewState));
          const { server } = await createForgeMcpServer(service);
          const [ct, st] = InMemoryTransport.createLinkedPair();
          const client = new Client({
            name: "unapproved-tool-adversary",
            version: "1",
          });
          await server.connect(st);
          await client.connect(ct);
          try {
            assert(
              !(await client.listTools()).tools.some(
                (tool) => tool.name === "internship_scout",
              ),
            );
            const call = await client.callTool({
              name: "internship_scout",
              arguments: { eventId: scenario.id, jobPosting: postings.amd },
            });
            assert.equal(call.isError, true);
            assert.equal(
              Object.keys((await service.store.read()).effects).length,
              0,
            );
          } finally {
            await client.close();
            await server.close();
          }
          observed =
            "Unapproved tool absent from registry and invocation rejected";
          break;
        }
        case "wrong-digest": {
          const service = new ForgeService(await seededStore(reviewState));
          await assert.rejects(
            () =>
              service.approve(
                seed.definition.id,
                seed.definition.version,
                "wrong-digest",
              ),
            /integrity/,
          );
          assert.equal(
            (await service.store.read()).releases[0].status,
            "review",
          );
          observed = "Stale approval digest cannot install release";
          break;
        }
        case "tampered-release": {
          const state = structuredClone(installedState);
          state.releases[0].definition.nodes[4].config.threshold = 0;
          const service = new ForgeService(await seededStore(state));
          await assert.rejects(
            () => service.trigger(cap.id, event),
            /integrity/,
          );
          assert.equal(
            Object.keys((await service.store.read()).effects).length,
            0,
          );
          observed = "Post-approval tampering prevents execution";
          break;
        }
        case "replayed-event": {
          const service = new ForgeService(await seededStore(installedState));
          const first = await service.trigger(cap.id, event);
          const second = await service.trigger(cap.id, event);
          assert.equal(first.status, "success");
          assert.equal(first.id, second.id);
          assert.equal((await service.store.read()).executions.length, 1);
          assert.equal(
            Object.keys((await service.store.read()).effects).length,
            1,
          );
          observed =
            "Replayed event reused execution; one notification persisted";
          break;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Boundary evaluation failed";
    }
    results.push({
      id: scenario.id,
      category: scenario.category,
      passed: !error,
      expected: "Enforce boundary without unauthorized side effects",
      observed,
      error,
      latencyMs: Math.round(performance.now() - start),
    });
  }
  return results;
}
