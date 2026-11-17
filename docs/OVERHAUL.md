# FORGE 2 overhaul — plan and state

This file lets a fresh session resume the overhaul. Update it at every gate.
The brief lives with the owner; its phases are summarized here.

## Environment (owner's machine)

- Windows 11, PowerShell, Node 24.13, Docker Desktop, RTX 5050 Laptop (8 GB).
- Ollama installed at `%LOCALAPPDATA%\Programs\Ollama`. Start it with
  `$env:OLLAMA_HOST='127.0.0.1:11435'; $env:OLLAMA_NO_CLOUD='1'; ollama serve`.
  Installed: qwen2.5:7b-instruct, qwen2.5-coder:1.5b/3b, qwen3.6 (22 GB), llava.
- Run Vitest from PowerShell (see DECISIONS D2).
- Do not touch `data/`, `data-local-inference/` or Docker volumes
  (`forge_forge-data` belongs to the running legacy container).

## Phases

- [x] **0. Safety net and strip-down** — tag `legacy-v0` pushed; branch
  `forge-2`; 347/347 legacy tests passed before deletion; legacy baseline
  recorded (1/18, D1); legacy products, AWS, Google, capsules, ForgeSpec, ML,
  voice, old docs and old model paths deleted; IR moved to `src/core/ir`.
  Gate: typecheck, lint, tests (52), build, boot — all observed green.
- [ ] **1. Spine** — contracts, events + tapes, scripted transport, SQLite
  store, bus + SSE, app shell + design system, Forge Floor on a scripted tape.
- [ ] **2. Language and execution** — recipe language (done early: parser,
  printer, engine, English, regex), lowering to IR, codecs, profiling,
  worker sandbox, grants and slots, property/differential/perf tests,
  docs/RECIPES.md.
- [ ] **3. Crucible** — intent, routing, K candidates with streaming, gates,
  execution on variants, properties, clustering, disambiguation, repair,
  exemplar memory, fix-by-example.
- [ ] **4. Product surfaces** — Home, Forge Floor, Toolbox, X-ray, views,
  version diffs, failure experience; tape-driven Playwright.
- [ ] **5. Tour and showcase mode.**
- [ ] **6. Stateful MCP, stdio bridge, Assistants page, Safety Lab.**
- [ ] **7. Evidence and finish** — validation set, benchmarks, Scorecard,
  arena, sealed holdout, docs, CI, palette, perf and a11y.

## Current state

Phase 0 complete. Core recipe language exists ahead of schedule with 13
hand-written recipes covering the dev corpus's file missions.

## Next

Phase 1: write the SQLite store, bus/SSE, scripted transport and the design
system; render a scripted tape end to end on the Forge Floor.
