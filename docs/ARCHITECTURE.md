# Architecture

FORGE turns a plain-language request and a file into an approved, callable
tool. A small local model drafts **recipes**; everything that makes the result
trustworthy is ordinary code around the model.

```
request + file
   │
   ▼  core/profile        column kinds, nulls, samples — no model
   ▼  core/synth intent   one constrained call: restatement, outputs + shapes, capabilities
   ▼  core/synth route    by rule: CONNECT · CLARIFY · UNSUPPORTED · REUSE · EXTEND · SYNTHESIZE
   ▼  K drafts            same prompt prefix, different seeds/temperatures, streamed
   ▼  gates               JSON schema → expressions → type check against the real schema
   ▼  execute             real data + 7 host-made variants + 3 seeded fuzz samples
   ▼  properties          names, shapes, numeric sorts, empty input, order, doubling, CSV read-back
   ▼  cluster             identical behavior groups; a clear majority wins ("3 of 4 agree")
   ▼  disambiguate        close split → smallest distinguishing input → "which did you mean?"
   ▼  repair              structured diagnostics; host repairs only when exactly one fix fits
   ▼  preview             instrumented run with lineage
   ▼  verify              emitted TypeScript vs interpreter on every test input
   ▼  review → approval (UI only) → install → MCP tools/list_changed
```

## Layout

| path | role | runs in |
| --- | --- | --- |
| `src/core/recipe` | language: schema, expression parser/printer, evaluator, English, regex, TS emitter | Node, browser worker, tests |
| `src/core/synth` | the Crucible, prompts, routing, exemplars, normalization, transports | anywhere |
| `src/core/verify` | variants, fuzz, properties, clustering, shrinking | anywhere |
| `src/core/events` | `BuildEvent`, the reducer, the tape format | anywhere |
| `src/core/contracts` | capabilities, passports and grants, JSON Schema subset, tool names | anywhere |
| `src/core/codec`, `profile` | CSV/TSV/JSON/text, column profiling | anywhere |
| `src/core/ir` | the earlier forge-ir/v1 core, kept executable | anywhere |
| `src/server/store` | SQLite (node:sqlite, WAL) and typed repositories | Node |
| `src/server/broker` | grants, integrity, receipts, deduplication | Node |
| `src/server/sandbox` | `worker_threads` pool for recipes | Node |
| `src/server/mcp` | stateful Streamable HTTP MCP, simulator | Node |
| `src/server/models` | Ollama streaming, scripted stand-in | Node |
| `src/server/egress.ts` | the one door out: loopback only | Node |
| `src/app` | Next.js pages and thin, Zod-validated API routes | Next |
| `src/ui` | design system and feature components | browser |
| `src/showcase` | sample datasets (seeded generators) | anywhere |
| `public/tapes` | recorded builds for the tour and showcase | static |

ESLint enforces the boundaries: `core/` imports nothing from Node, React,
Next, `server/` or `ui/`, and contains no `eval` or `new Function`; `ui/`
never imports `server/`; server code may not call `fetch` except in
`egress.ts`.

## Events and tapes

Every build is an ordered stream of `BuildEvent`s (`core/events/types.ts`):
`build.started`, `profile.ready`, `intent.ready`, `route.decided`,
`candidate.started/delta/parsed/rejected/executed`, `check.result`,
`consensus.formed`, `ambiguity.found/resolved`, `example.added`,
`preview.ready`, `review.ready`, `approved`, `installed`, `model.stats`,
`build.failed`, `build.ended`. The server appends each to SQLite and publishes
it on an in-process bus; `/api/builds/:id/events` streams it over SSE and
resumes from `Last-Event-ID`.

The UI is a pure reducer over the stream (`core/events/reducer.ts`). A tape
(`forge-tape/1`) is a recorded stream plus its input files. The same
components render a live build, a tape in the tour, a tape in a Playwright
test and a failed benchmark mission on the Scorecard. Every build carries a
provenance label that is always visible: **LIVE** (a model is generating now),
**RECORDED** (a real past run, with model, hardware and date) or **SCRIPTED**
(a deterministic stand-in).

## The Crucible on a 7B model

`runCrucible` (`core/synth/crucible.ts`) is transport-independent: it emits
events and calls injected dependencies (model transport, `ask` for
disambiguation, `verify` for translation validation), so the same code runs
live, scripted, in benchmarks and in tests.

- **Drafts.** Default K = 5 at temperatures 0.2–1.0 with fixed seeds and two
  in flight. The prompt prefix (rules, the three most similar exemplars, the
  data profile with sample rows) is identical across drafts, so Ollama's
  prefix cache pays for it once. Structure is guaranteed by Ollama's `format`
  JSON Schema; expressions are parsed by FORGE with located errors.
- **Exemplars.** 43 hand-written recipes, each a test, retrieved by local
  TF-IDF + trigram similarity. A test proves none resembles an evaluation
  mission. Approved tools join a local memory (Settings can turn it off);
  benchmarks run without it.
- **Early exit.** Three agreeing drafts with no rival pair stop the rest.
  Drafts that produce nothing on the real data don't count toward it.
- **Properties.** Chosen from the program's shape (`core/verify/properties.ts`):
  the files and columns the request names, the JSON template it writes, the
  output shape the intent call expected, numeric text sorted as numbers,
  empty input, row-order invariance for aggregates, doubling rows doubles
  sums and counts only, CSV read-back.
- **Repair.** Rejected drafts get up to two repairs from structured
  diagnostics ("unknown column amout; did you mean amount?"). Where exactly
  one fix is consistent with the data, the host applies it and says so as a
  visible check: aligning an output's shape to the intent reading, or adding
  `by` to a summarize that dropped a column the output needs.
- **Disambiguation.** When the top two behavior clusters are within one vote,
  FORGE finds the smallest input on which they differ (greedy row deletion)
  and asks which result was meant. The answer becomes a stored example.
- **Fix by example.** Editing a preview cell or removing a row becomes a hard
  constraint: the build reruns and every surviving draft must reproduce it.

## Runtime

- **Store.** `node:sqlite` in WAL mode under `FORGE_HOME` (default `.forge/`):
  files, builds, events, tools, versions, runs, artifacts, receipts, examples,
  memory, settings. The legacy `data/` directory is never touched.
- **Approval.** Only `POST /api/builds/:id/approve` (same-origin, loopback or
  owner token) approves. It re-derives the recipe and hash from the stored
  events, refuses any mismatch, and can only *narrow* grants (any file → this
  exact file or a watched folder). New versions never inherit grants and show
  their permission delta.
- **Broker.** Every run: tool active → version approved → recomputed hash
  equals approved hash → each input matches a read grant (scope and size) →
  sandboxed execution → each proposed output matches a write grant by exact
  name and size → commit with an effect key. A repeated event key writes
  nothing new. Every refusal leaves a receipt.
- **Sandbox.** Recipes run in a `worker_threads` worker (bundled to
  `.forge-build/recipe-worker.mjs`) with a 512 MB heap ceiling, an empty
  environment and a wall-clock kill; the worker receives file text, never
  paths, and returns proposals.
- **MCP.** `src/server/mcp/hub.ts`: Streamable HTTP with sessions and a
  server-to-client stream. Static tools `forge_build`, `forge_status`,
  `forge_list`; each approved tool is registered as its own tool and removed
  on revocation, which notifies connected clients. `npx forge mcp` bridges
  stdio clients.

## Two run modes, one codebase

**Local** runs the Node server, Ollama, MCP and SQLite. **Showcase**
(`FORGE_MODE=showcase`, built to `.next-showcase/`) needs no model and no
server state: builds play tapes from `public/tapes`, tools run in the
visitor's browser in a Web Worker using `core/`, mutating routes refuse, and
there is no MCP endpoint. A fresh clone without a model starts in local mode
with recorded builds and a banner explaining how to turn on live generation.

## Translation validation (D10)

`core/recipe/emit-ts.ts` emits a recipe as plain TypeScript: explicit loops,
hash maps, sorts and column bookkeeping, sharing only value semantics with
the interpreter. `server/verify.ts` compiles it with `tsc`, runs it in an
empty `vm` context on the real data and every variant, and requires
byte-identical encoded outputs. All 43 exemplars pass on 11 inputs each; the
check runs on every build's winner and appears under the hood.
