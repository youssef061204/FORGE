import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { z } from "zod";
import { validateCapability, type Capability, type ForgeEvent } from "./spec";
import type { StateStore } from "./store";
import type { Execution } from "./records";
import { PermissionBroker, type Fault } from "./broker";
import type { LiveContext } from "./live-broker";
import type { CityContext } from "./environment";
import { liveOperations } from "./live-contracts";

export interface Sandbox {
  run(
    capability: Capability,
    event: ForgeEvent,
    store: StateStore,
    fault?: Fault,
    context?: LiveContext | CityContext,
  ): Promise<Execution>;
}
const callSchema = z
  .object({
    kind: z.literal("call"),
    requestId: z.number().int().positive(),
    nodeId: z.string().max(64),
    operation: z.string().max(64),
    token: z.string(),
  })
  .strict();
export class IsolatedSandbox implements Sandbox {
  constructor(private mode: "process" | "docker" = "process") {}
  async run(
    raw: Capability,
    event: ForgeEvent,
    store: StateStore,
    fault?: Fault,
    context?: LiveContext | CityContext,
  ): Promise<Execution> {
    const cap = validateCapability(raw);
    const startedAt = new Date().toISOString();
    const start = performance.now();
    if (context) context.sandboxMode = this.mode;
    const broker = new PermissionBroker(
      cap,
      event,
      store,
      fault,
      undefined,
      context,
    );
    const base: Execution = {
      id: randomUUID(),
      capabilityId: cap.id,
      version: cap.version,
      eventId: event.id,
      trigger: event.type,
      startedAt,
      endedAt: startedAt,
      latencyMs: 0,
      status: "success",
      trace: [],
      outcome: {},
      permissionDenials: 0,
      toolCalls: 0,
      model: "deterministic-primitives",
      tokens: 0,
      estimatedCost: 0,
      sandbox: this.mode,
    };
    if (event.type !== cap.trigger)
      return {
        ...base,
        status: "ignored",
        outcome: { reason: "Trigger does not match" },
      };
    const temporary = await mkdtemp(join(tmpdir(), "forge-"));
    const token = randomUUID();
    const worker = resolve("sandbox/worker.mjs");
    const containerName = `forge-${randomUUID()}`;
    const args =
      this.mode === "docker"
        ? [
            "run",
            "--rm",
            "-i",
            "--name",
            containerName,
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit=16",
            "--memory=128m",
            "--cpus=0.5",
            "forge-sandbox:local",
          ]
        : [
            "--permission",
            `--allow-fs-read=${worker}`,
            "--max-old-space-size=64",
            "--disable-proto=throw",
            worker,
          ];
    const env: NodeJS.ProcessEnv =
      this.mode === "docker"
        ? {
            NODE_ENV: "production",
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            USERPROFILE: process.env.USERPROFILE,
          }
        : {
            NODE_ENV: "production",
            SystemRoot: process.env.SystemRoot,
            TZ: "UTC",
          };
    const child = spawn(
      this.mode === "docker" ? "docker" : process.execPath,
      args,
      {
        cwd: temporary,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let error: string | undefined;
    let done = false;
    let outputBytes = 0;
    let inFlight = false;
    try {
      await new Promise<void>((resolveDone) => {
        const timer = setTimeout(() => {
          error = "Sandbox wall-time limit exceeded";
          child.kill();
        }, cap.policies.maxRuntimeMs);
        const lines = createInterface({ input: child.stdout });
        child.stderr.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > 65536) {
            error = "Sandbox output limit exceeded";
            child.kill();
          }
        });
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > 65536) {
            error = "Sandbox output limit exceeded";
            child.kill();
          }
        });
        lines.on("line", async (line) => {
          try {
            const message: unknown = JSON.parse(line);
            const marker = z
              .object({ kind: z.string() })
              .passthrough()
              .parse(message);
            if (marker.kind === "done") {
              if (broker.results.size !== cap.nodes.length || inFlight)
                throw new Error("Worker completed an incomplete program");
              done = true;
              child.stdin.end();
              return;
            }
            if (marker.kind === "error") {
              error = z
                .object({ error: z.string().max(1000) })
                .parse(message).error;
              child.stdin.end();
              return;
            }
            const call = callSchema.parse(message);
            if (call.token !== token || inFlight)
              throw new Error(
                "Invalid capability token or concurrent broker request",
              );
            inFlight = true;
            let value;
            let callError;
            try {
              value = await broker.invoke(call.nodeId, call.operation);
            } catch (e) {
              callError =
                e instanceof Error ? e.message : "Broker rejected request";
            } finally {
              inFlight = false;
            }
            if (!child.stdin.destroyed)
              child.stdin.write(
                JSON.stringify({
                  kind: "reply",
                  requestId: call.requestId,
                  value,
                  error: callError,
                }) + "\n",
              );
          } catch (e) {
            error = e instanceof Error ? e.message : "Protocol failure";
            child.kill();
          }
        });
        child.on("error", (e) => {
          error = e.message;
          clearTimeout(timer);
          resolveDone();
        });
        child.on("close", (code) => {
          if (!done && !error)
            error = `Sandbox exited without completion (${code})`;
          clearTimeout(timer);
          lines.close();
          resolveDone();
        });
        child.stdin.on("error", () => {
          /* exit handler records failed subprocess */
        });
        child.stdin.write(
          JSON.stringify({ kind: "start", nodes: cap.nodes, token }) + "\n",
        );
      });
    } finally {
      child.kill();
      if (this.mode === "docker")
        await new Promise<void>((finished) => {
          const cleanup = spawn("docker", ["rm", "-f", containerName], {
            windowsHide: true,
            stdio: "ignore",
          });
          cleanup.on("error", () => finished());
          cleanup.on("close", () => finished());
        });
      await rm(temporary, { recursive: true, force: true });
    }
    const outcome = Object.fromEntries(
      [...broker.results].map(([id, value]) => {
        const operation = cap.nodes.find((n) => n.id === id)!.operation;
        return [
          id,
          [
            ...liveOperations,
            "resume.read",
            "posting.read",
            "posting.normalize",
          ].includes(operation)
            ? { redacted: true, reference: `node:${id}` }
            : value,
        ];
      }),
    );
    return {
      ...base,
      endedAt: new Date().toISOString(),
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
      status: error ? "failed" : "success",
      error,
      trace: broker.trace,
      outcome,
      permissionDenials: broker.permissionDenials,
      toolCalls: broker.toolCalls,
    };
  }
}
