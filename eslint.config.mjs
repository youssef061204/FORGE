import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const nodeBuiltins = ["node:*", "fs", "path", "child_process", "worker_threads", "net", "http", "https", "crypto", "os", "vm"];

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // core/ runs unchanged in Node, a browser worker and tests.
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: nodeBuiltins, message: "core/ is isomorphic: no Node built-ins." },
            { group: ["react", "react-dom", "next", "next/*"], message: "core/ has no UI or framework code." },
            { group: ["**/server/**", "@/server/*", "**/ui/**", "@/ui/*", "**/app/**", "@/app/*"], message: "core/ depends on nothing outside core/." },
            { group: ["ajv", "ajv/*"], message: "Ajv compiles with new Function; use core/contracts/json-schema.ts." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Function']", message: "No eval-style code generation in core/." },
        { selector: "CallExpression[callee.name='eval']", message: "No eval in core/." },
        { selector: "CallExpression[callee.name='fetch']", message: "core/ never talks to the network." },
      ],
    },
  },
  // The UI talks to the server over HTTP only.
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/server/**", "@/server/*"], message: "ui/ reaches the server through /api only." }, { group: nodeBuiltins, message: "ui/ runs in the browser." }] }],
    },
  },
  // One door out: server-side HTTP goes through server/egress.ts.
  {
    files: ["src/server/**/*.ts", "src/app/api/**/*.ts"],
    ignores: ["src/server/egress.ts"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "CallExpression[callee.name='fetch']", message: "Use egressFetch from server/egress.ts (loopback only)." }],
    },
  },
  globalIgnores([".venv-ml/**", ".next/**", ".forge/**", ".forge-build/**", "data/**", "artifacts/**", "playwright-report/**", "test-results/**", "next-env.d.ts", "evaluation/core-holdout-2026-11-12/*.cjs"]),
]);
