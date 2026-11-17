# Decisions

Non-obvious choices, a few lines each. Newest last.

**D1. Baseline before change (2026-11-17).** Ollama was installed but stopped;
started it on `127.0.0.1:11435` with `OLLAMA_NO_CLOUD=1` and ran the unmodified
legacy runner at `c8b172f`. The grounded IR path solved **1 of 18** dev
missions with qwen2.5:7b-instruct on the RTX 5050 (15 failed, 2 blocked).
13 of 14 file missions failed IR admission with malformed nested trees, which
supports moving the model to a flat surface language. The previously published
7/18 came from the older TypeScript path. Result:
`evaluation/results/2026-11-17-c8b172f-legacy-baseline/result.json`.

**D2. Vitest on Windows.** Running Vitest from Git Bash fails every file at
collection (`/c/...` vs `C:/...` module identity). Use PowerShell or CI.

**D3. node:sqlite over better-sqlite3.** Built into Node 24, no native build on
Windows, WAL works, 20k inserts in ~14 ms. It prints one ExperimentalWarning.

**D4. Ajv is out of core.** Ajv compiles with `new Function`, which a strict CSP
forbids. core/ uses a ~200-line validator for exactly the vocabulary
forge-ir/v1 already restricted itself to (`core/contracts/json-schema.ts`).
Zod runs with `z.config({ jitless: true })` for the same reason.

**D5. Synchronous SHA-256 in core.** Approval binds to hashes that must be
identical in Node and the browser worker; Web Crypto is async-only, so core/
carries a small SHA-256 (`core/hash.ts`), tested against Node's crypto.

**D6. A linear-time regex engine.** Recipes may only use `core/recipe/regex.ts`
(Pike VM, no backreferences or lookaround), so `(a+)+$` cannot stall a tool.
Lazy quantifiers and named groups are supported because extraction tasks
need them.

**D7. Recipe execution vs IR.** The recipe evaluator (`core/recipe/engine.ts`)
executes tools: it is fast (hash joins, hash grouping), records lineage, and
enforces a row-step budget. Each recipe also lowers to forge-ir/v1, whose hash
(with the recipe and compiler version) is what approval binds. The IR reference
evaluator and the TypeScript emitted from the IR are differential checks on
fuzz inputs. The IR keeps its historical 1,000-row limits; it is a verifier,
not the production executor.

**D8. Arithmetic reads text as numbers; ordering does not.** CSV cells stay
text so "9.50" survives a round trip. `+ - * /` read numeric text as numbers.
Comparisons with a number on one side do the same. Sorting a text column is
by code point, so sorting amounts needs `num(amount)`; a property check flags a
sort over all-numeric text so repair can suggest it. Division by zero gives
nothing (null), not an error.

**D9. The legacy runtime is not carried forward.** The sealed holdout was
written for the legacy ProductRuntime (connector writes, scheduler ticks,
program state). Keeping that runtime alive in main contradicts the rebuild.
It remains runnable from the `legacy-v0` tag. At the final freeze, the new
architecture runs the holdout missions it can represent through a new adapter,
and the report states exactly which missions and predicates were not run and
why. The adapter classifies missions generically from their resource handlers,
never by ID or wording.
