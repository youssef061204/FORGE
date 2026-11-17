/** In-process event bus. SSE streams and the MCP server subscribe here. */
import { EventEmitter } from "node:events";
import type { BuildEvent } from "../core/events/types";

export type GlobalEvent =
  | { t: "build.created"; buildId: string; request: string }
  | { t: "build.ended"; buildId: string; outcome: string }
  | { t: "tools.changed"; reason: "installed" | "revoked" | "paused" | "resumed"; toolId: string }
  | { t: "run.finished"; toolId: string; runId: string; status: string; summary: string }
  | { t: "mcp.wire"; session: string; direction: "in" | "out"; message: unknown; caption: string; at: string };

export class Bus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(200);
  }
  publishBuild(e: BuildEvent) {
    this.emitter.emit(`build:${e.buildId}`, e);
  }
  onBuild(buildId: string, f: (e: BuildEvent) => void): () => void {
    this.emitter.on(`build:${buildId}`, f);
    return () => this.emitter.off(`build:${buildId}`, f);
  }
  publish(e: GlobalEvent) {
    this.emitter.emit("global", e);
  }
  on(f: (e: GlobalEvent) => void): () => void {
    this.emitter.on("global", f);
    return () => this.emitter.off("global", f);
  }
}
