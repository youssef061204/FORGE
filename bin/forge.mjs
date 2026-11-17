#!/usr/bin/env node
// forge mcp | forge doctor | forge (start everything)
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmd = process.argv[2] ?? "start";
const script = { mcp: "scripts/mcp-stdio.ts", doctor: "scripts/doctor.ts", start: "scripts/forge.ts" }[cmd];
if (!script) {
  console.error("Usage: forge [start|mcp|doctor]");
  process.exit(1);
}
const child = spawn(process.execPath, ["--import", "tsx", join(root, script), ...process.argv.slice(3)], { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
