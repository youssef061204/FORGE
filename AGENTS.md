<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on FORGE

FORGE builds the tool an AI assistant is missing. A local model drafts small
programs in a recipe language, FORGE tests them, shows exactly what each may
touch, and installs one as an MCP tool only after a person approves it.

Start with `docs/OVERHAUL.md` (current state and next steps), then
`docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

## Layout

- `src/core/` — isomorphic TypeScript. Runs unchanged in Node, a browser Web
  Worker and tests. No `node:` imports, no DOM, no `eval`/`new Function`
  (so no Ajv here; use `core/contracts/json-schema.ts`).
  - `recipe/` the surface language, `ir/` the verified forge-ir/v1 core,
    `codec/`, `profile/`, `synth/` (the Crucible), `verify/`, `view/`,
    `events/` (BuildEvent, reducer, tapes), `contracts/`.
- `src/server/` — Node only: SQLite store, broker, sandbox, models, MCP, bus.
- `src/app/` — Next.js routes; API handlers stay thin and validate with Zod.
- `src/ui/` — design system and feature components.
- `src/showcase/` — sample datasets, the tour script and tapes.
- `evaluation/` — corpora, runners and committed results.

ESLint enforces these boundaries.

## Rules that protect the product's promises

- Free and local: no paid service, cloud model, CDN or telemetry. All server
  outbound HTTP goes through `src/server/egress.ts` (loopback only).
- Generated programs hold no authority. The broker checks every proposed
  effect against grants bound to an exact hash. Default deny.
- Only a human approves, in the FORGE UI. No MCP call can approve anything.
- Never loosen a sandbox limit or security check to make a test pass.
- Never present scripted or recorded output as live. Every published number
  needs a committed result file and a command that reproduces it.
- Explanations of what a tool does are rendered from the program
  (`core/recipe/english.ts`), never written by a model.
- Nothing in the product may branch on a mission ID or corpus phrase.
- The sealed holdout in `evaluation/core-holdout-2026-11-12/` stays sealed:
  read only `PROTOCOL.md` and `schema.json` until the final source freeze.
- Do not touch the owner's `data/` directory or Docker volumes.

## Commands

`npm run forge` (start everything), `npm run doctor`, `npm run dev`,
`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`,
`npm run build`.

On Windows, run Vitest from PowerShell: Git Bash's `/c/...` path casing makes
Vitest load test files twice and fail at collection.
