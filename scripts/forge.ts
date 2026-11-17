/**
 * npm run forge: check the environment, find a local model, build if needed,
 * start FORGE on http://127.0.0.1:3110 and open the browser. Without a model
 * it still starts: recorded builds, the tour and installed tools all work.
 *
 *   npm run forge            production server (builds once)
 *   npm run forge -- --dev   development server
 *   npm run forge -- --no-open
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { doctor } from "./doctor";

const args = new Set(process.argv.slice(2));
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function newest(dir: string): number {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

const { checks, model, url } = await doctor();
const failed = checks.filter((c) => c.ok === false);
for (const c of checks) if (c.ok !== true) console.log(`${c.ok === false ? "✕" : "·"} ${c.name}: ${c.detail}${c.fix ? `\n    → ${c.fix}` : ""}`);
if (failed.length) process.exit(1);
console.log(model ? `\n● Live generation with ${model} at ${url}` : "\n○ No local model found: FORGE starts with recorded builds. See Settings to turn on live generation.");

spawnSync(process.execPath, ["scripts/build-worker.mjs"], { stdio: "inherit", env });
const dev = args.has("--dev");
if (!dev) {
  const stale = !existsSync(".next/BUILD_ID") || newest("src") > statSync(".next/BUILD_ID").mtimeMs;
  if (stale) {
    console.log("Building FORGE (once; about a minute)…");
    const b = spawnSync(npx, ["next", "build"], { stdio: "inherit", env, shell: process.platform === "win32" });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
}
const server = spawn(npx, ["next", dev ? "dev" : "start", "--hostname", "127.0.0.1", "--port", "3110"], { stdio: ["inherit", "pipe", "inherit"], env, shell: process.platform === "win32" });
let opened = false;
server.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (!opened && /Ready|started server|Local:/i.test(chunk.toString())) {
    opened = true;
    const target = "http://127.0.0.1:3110";
    console.log(`\nFORGE is running at ${target}`);
    if (!args.has("--no-open")) {
      const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
      spawn(cmd[0] as string, cmd[1] as string[], { stdio: "ignore", detached: true }).unref();
    }
  }
});
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));
