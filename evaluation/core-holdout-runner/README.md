# Running the sealed holdout against FORGE 2

The corpus in `../core-holdout-2026-11-12/` was sealed for the legacy
architecture. FORGE 2 runs what it can represent and reports exactly what it
cannot. The legacy runner remains at the `legacy-v0` tag.

1. `npx tsx evaluation/holdout-freeze.ts` — records the commit, the `src/`
   tree hash and the holdout seal in `evaluation/results/holdout-freeze.json`.
   Requires a clean tree. Nothing sealed is opened.
2. `npx tsx evaluation/holdout-capture.ts --freeze=evaluation/results/holdout-freeze.json`
   — verifies every sealed file's hash and that `src/` is the frozen tree, then
   runs all 100 missions once through the live Crucible. It reads
   `missions.sealed.jsonl` only; it never opens the oracle, the authored
   recordings or the authoring script. Output: `captured.jsonl` and one tape
   per mission.
3. `npx tsx evaluation/holdout-score.ts <run dir>` — opens
   `expected.sealed.jsonl` for the first time and scores the captured results
   by mission id.

How fixtures reach FORGE 2: documents found in connected resources become
input files; other read results become JSON files. FORGE 2 has no
connector-write path, so its only effects are output files committed through
the broker; the initial event runs twice to count duplicate writes.
Predicates about connector collections, scheduler ticks, program state,
legacy installed programs or extension lineage have no FORGE 2 counterpart
and are reported as not applicable, mission by mission.
