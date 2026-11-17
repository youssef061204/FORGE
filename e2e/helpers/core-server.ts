import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { coreOwnerToken, coreResponses } from "./core-responses";
import { LocalStateStore } from "../../src/forge/store";
import { emptyProductState } from "../../src/forge/product/contracts";
import { digest } from "../../src/forge/hash";

const executeFile = promisify(execFile);
export const corePort = 3120;
export const coreOrigin = `http://127.0.0.1:${corePort}`;

export class CoreBrowserServer {
  readonly directory = resolve(
    "artifacts/core-browser",
    `run-${Date.now()}-${process.pid}`,
  );
  readonly dataDirectory = resolve(this.directory, "state");
  private child?: ChildProcess;
  private starts = 0;
  readonly processIds: number[] = [];

  async start() {
    if (this.child)
      throw new Error("The isolated browser server is already running");
    // A conflicting listener is an error. Never use or kill an unrelated server.
    if (await this.responds())
      throw new Error(
        `Port ${corePort} is already in use; stop the other server first`,
      );
    await mkdir(this.directory, { recursive: true });
    const responsesPath = resolve(this.directory, "recorded-responses.json");
    await writeFile(responsesPath, JSON.stringify(coreResponses(), null, 2));
    const environment = { ...process.env };
    for (const key of Object.keys(environment))
      if (
        key.startsWith("AWS_") ||
        key.startsWith("GOOGLE_") ||
        key.startsWith("BEDROCK_") ||
        key.startsWith("FORGE_")
      )
        delete environment[key];
    Object.assign(environment, {
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      FORGE_APP_MODE: "test",
      FORGE_PLANNER_PROVIDER: "offline",
      FORGE_PRODUCT_TEST_RESPONSES: responsesPath,
      FORGE_DATA_DIR: this.dataDirectory,
      FORGE_API_TOKEN: coreOwnerToken,
      FORGE_FREE_ONLY: "true",
      FORGE_RUNTIME_MODE: "fixture",
      FORGE_MISSION_REQUEST_CAP: "0",
      MODEL_PROVIDER: "demo",
      STORE_PROVIDER: "local",
      SANDBOX_PROVIDER: "process",
      DEMO_MODE: "true",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_CALENDAR_ID: "",
    });
    const log = createWriteStream(
      resolve(this.directory, `server-${++this.starts}.log`),
    );
    const child = spawn(
      process.execPath,
      [
        resolve("node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(corePort),
      ],
      {
        env: environment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    if (child.pid) this.processIds.push(child.pid);
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once("close", () => log.end());
    let spawnFailure: Error | undefined;
    child.once("error", (error) => {
      spawnFailure = error;
    });
    try {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (spawnFailure) throw spawnFailure;
        if (child.exitCode !== null)
          throw new Error(
            `Isolated TEST server exited with ${child.exitCode}; inspect ${this.directory}`,
          );
        const ready = await fetch(`${coreOrigin}/api/product`, {
          headers: { Authorization: `Bearer ${coreOwnerToken}` },
          signal: AbortSignal.timeout(3000),
        }).catch(() => undefined);
        if (ready?.ok) return;
        await new Promise((done) => setTimeout(done, 250));
      }
      throw new Error(
        `Isolated TEST server did not become ready; inspect ${this.directory}`,
      );
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private async responds() {
    return Boolean(
      await fetch(`${coreOrigin}/api/health`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined),
    );
  }

  async stop() {
    const child = this.child;
    this.child = undefined;
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === "win32")
      await executeFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch((error) => {
        if (child.exitCode === null) throw error;
      });
    else child.kill("SIGTERM");
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!(await this.responds())) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(
      "The isolated TEST server did not stop; restart proof is incomplete",
    );
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async fillWorkspaceCapacity() {
    const store = new LocalStateStore(this.dataDirectory);
    await store.transaction((state) => {
      const workspace = (state.product ??= emptyProductState()).workspace;
      while (workspace.artifacts.length < 100) {
        const index = workspace.artifacts.length;
        const key = digest({ kind: "core-browser-capacity", index });
        const text = `capacity fixture ${index}`;
        workspace.artifacts.push({
          id: "a" + key.slice(0, 24),
          name: `capacity-${index}.txt`,
          format: "text",
          text,
          bytes: Buffer.byteLength(text),
          sha256: digest(text),
          createdAt: "2026-11-16T15:00:00.000Z",
          effectKey: key,
        });
      }
    });
  }
}
