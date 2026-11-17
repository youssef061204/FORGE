// Bundles the recipe sandbox worker so dev, production and tests run the same file.
import { build } from "esbuild";
await build({
  entryPoints: ["src/server/sandbox/recipe-worker.ts"],
  outfile: ".forge-build/recipe-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
  banner: { js: "// Built by scripts/build-worker.mjs. Do not edit." },
});
