/** npm run doctor: check everything FORGE needs, and say how to fix what's missing. */
import { execSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { chooseModel, discoverOllama } from "../src/server/models/ollama";
import { forgeHome } from "../src/server/store/db";

type Check = { name: string; ok: boolean | "warn"; detail: string; fix?: string };

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

export async function doctor(): Promise<{ checks: Check[]; model?: string; url?: string }> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js", ok: major >= 22, detail: process.versions.node, fix: "Install Node.js 22 or newer (node:sqlite is built in from 22.5)." });
  checks.push({ name: "Dependencies", ok: existsSync("node_modules/next"), detail: existsSync("node_modules/next") ? "installed" : "missing", fix: "npm install" });
  checks.push({ name: "Sandbox worker", ok: existsSync(".forge-build/recipe-worker.mjs") ? true : "warn", detail: existsSync(".forge-build/recipe-worker.mjs") ? "built" : "not built yet (npm run forge builds it)" });
  const home = forgeHome();
  let writable = true;
  try {
    mkdirSync(home, { recursive: true });
    accessSync(home, constants.W_OK);
  } catch {
    writable = false;
  }
  checks.push({ name: "Data folder", ok: writable, detail: home, fix: "Set FORGE_HOME to a folder you can write to." });
  const free = await portFree(3110);
  checks.push({ name: "Port 3110", ok: free ? true : "warn", detail: free ? "free" : "in use (FORGE may already be running)", fix: "Stop the other process or open http://127.0.0.1:3110" });
  const found = await discoverOllama(process.env.FORGE_OLLAMA_URL);
  let model: string | undefined;
  if (!found)
    checks.push({
      name: "Local model",
      ok: "warn",
      detail: "no Ollama on 127.0.0.1:11434 or :11435; recorded builds and installed tools still work",
      fix: "Install Ollama, run `ollama pull qwen2.5:7b-instruct` yourself, then start it with OLLAMA_HOST=127.0.0.1:11435 OLLAMA_NO_CLOUD=1 ollama serve",
    });
  else {
    model = chooseModel(found.models, process.env.FORGE_MODEL);
    checks.push({ name: "Ollama", ok: true, detail: `${found.url} · ${found.models.length} local models` });
    checks.push({
      name: "Model",
      ok: model ? (/qwen2\.5:7b-instruct/.test(model) ? true : "warn") : false,
      detail: model ?? "no usable model installed",
      fix: model ? "Benchmarks used qwen2.5:7b-instruct; others work but are unmeasured." : "ollama pull qwen2.5:7b-instruct (FORGE never downloads models itself)",
    });
  }
  try {
    const gpu = execSync("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    checks.push({ name: "GPU", ok: true, detail: gpu });
  } catch {
    checks.push({ name: "GPU", ok: "warn", detail: "no NVIDIA GPU detected; generation runs on CPU and is slower" });
  }
  checks.push({ name: "Telemetry", ok: process.env.NEXT_TELEMETRY_DISABLED === "1" ? true : "warn", detail: process.env.NEXT_TELEMETRY_DISABLED === "1" ? "off" : "npm run forge turns Next.js telemetry off for you" });
  return { checks, model, url: found?.url };
}

if (process.argv[1] && /doctor\.ts$/.test(process.argv[1])) {
  const { checks } = await doctor();
  for (const c of checks) {
    const mark = c.ok === true ? "ok  " : c.ok === "warn" ? "note" : "FAIL";
    console.log(`${mark}  ${c.name.padEnd(15)} ${c.detail}`);
    if (c.ok !== true && c.fix) console.log(`      → ${c.fix}`);
  }
  process.exit(checks.some((c) => c.ok === false) ? 1 : 0);
}
