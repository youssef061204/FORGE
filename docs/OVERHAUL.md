# FORGE 2 overhaul — plan and state

This file lets a fresh session resume the overhaul. The brief lives with the
owner; its phases are summarized here.

## Environment (owner's machine)

- Windows 11, PowerShell, Node 24.13, Docker Desktop, RTX 5050 Laptop (8 GB).
- Ollama at `%LOCALAPPDATA%\Programs\Ollama`. Start it with
  `$env:OLLAMA_HOST='127.0.0.1:11435'; $env:OLLAMA_NO_CLOUD='1'; ollama serve`.
  Installed: qwen2.5:7b-instruct (used for every measurement), qwen2.5-coder
  1.5b/3b, qwen3.6 (22 GB), llava.
- FORGE 2 runs on **127.0.0.1:3110**; 3108 is the owner's legacy container.
- Run Vitest from PowerShell (D2). Run `scripts/shoot.mjs` from PowerShell:
  Git Bash rewrites arguments that start with `/`.
- Never touch `data/`, `data-local-inference/`, `.venv-ml/` or Docker volumes.

## Phases

- [x] **0. Safety net and strip-down.** `legacy-v0` tagged and pushed; branch
  `forge-2`; 347/347 legacy tests green before deletion; legacy baseline 1/18.
- [x] **1. Spine.** Events and tapes, scripted transport, SQLite store, bus and
  SSE, app shell and design system, Forge Floor on live and recorded streams.
- [x] **2. Language and execution.** Recipe language, evaluator with lineage,
  codecs, profiling, 10 MB / 100k-row limits, worker sandbox, grants.
  Translation validation by emitted TypeScript instead of IR lowering (D10).
  docs/RECIPES.md. Fuzz, differential and 100k performance tests pass.
- [x] **3. Crucible.** Intent, rule routing, K streamed drafts, gates,
  variants, properties, clustering, disambiguation, repair, host repairs,
  exemplar memory, fix-by-example. Dev 17/18, validation 56/71 (first run).
- [x] **4. Product surfaces.** Home, Forge Floor, Toolbox, X-ray, versions with
  behavior diff, access/revoke, history, examples, eject, failure experience.
- [x] **5. Tour and showcase.** Seven-step tour on a real tape, autoplay,
  24 recorded sample tapes, in-browser runs, showcase build. Gate observed:
  tour e2e passes on local and showcase builds at 1440×900 and 390×844.
- [x] **6. Bridge and proof.** Stateful MCP with list_changed (SDK test),
  stdio bridge, Assistants page with live wire and simulator, Safety Lab with
  eleven attacks all blocked as tests.
- [x] **7. Evidence and finish.** Validation set, benchmarks, Scorecard,
  sealed holdout (frozen at `c8d9788`, tag `holdout-freeze`), docs, CI,
  command palette, contrast pass. See "Not done" below.

## Not done (next)

- (Done after the freeze) Toolbox Schedule: interval and watched folder,
  with a live dashboard from the latest view (tests/server/scheduler.test.ts).
- **Model arena** and the Scorecard's live "run the benchmark" wall.
- Learned-memory improvement is not yet measured (benchmarks run without it).
- Custom-code escape hatch (process/Docker jail) is not implemented; it is off
  and documented as off.
- Stretch items (WebGPU model, XLSX, pipelines, chat assistant, city).

## How to verify

`npm run typecheck && npm run lint && npm test && npm run build`;
`npx playwright test` (scripted model, desktop and phone);
`npx tsx evaluation/runner.ts --corpus=dev|validation` (needs Ollama);
`npm run tapes:record` re-records sample tapes from the live model.
