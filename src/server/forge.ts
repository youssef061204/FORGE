/** Process-wide FORGE services, kept on globalThis so dev reloads reuse them. */
import { BuildService } from "./builds";
import { Broker } from "./broker/broker";
import { Bus } from "./bus";
import { SandboxPool } from "./sandbox/pool";
import { openDatabase } from "./store/db";
import { Repo } from "./store/repo";
import { McpHub } from "./mcp/hub";
import { Scheduler } from "./scheduler";

export type Forge = { repo: Repo; bus: Bus; pool: SandboxPool; broker: Broker; builds: BuildService };

const g = globalThis as typeof globalThis & { __forge?: Forge; __mcp?: McpHub; __scheduler?: Scheduler };

export function forge(): Forge {
  if (!g.__forge) {
    const repo = new Repo(openDatabase());
    const bus = new Bus();
    const pool = new SandboxPool(2);
    g.__forge = { repo, bus, pool, broker: new Broker(repo, pool, bus), builds: new BuildService(repo, bus) };
    if (!isShowcase()) {
      g.__scheduler = new Scheduler(g.__forge);
      g.__scheduler.start();
    }
  }
  return g.__forge;
}

export function isShowcase(): boolean {
  return process.env.FORGE_MODE === "showcase";
}

export function mcpHub(): McpHub {
  g.__mcp ??= new McpHub(forge());
  return g.__mcp;
}
