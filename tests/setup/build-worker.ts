import { execFileSync } from "node:child_process";

/** Vitest global setup: tests run the same bundled worker the app runs. */
export default function setup() {
  execFileSync(process.execPath, ["scripts/build-worker.mjs"], { stdio: "inherit" });
}
