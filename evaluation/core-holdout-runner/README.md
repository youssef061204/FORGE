# Generic holdout runner

The implementation in `scripts/evaluate-core-holdout.ts` is evaluation-only. It imports no expected outcomes into production code. It cannot open a mission corpus unless `--freeze` supplies an architecture precommitment. The frozen corpus, oracle, recordings, authoring script, and their original manifest remain immutable.

The source-freeze JSON must contain:

```json
{
  "frozenAt": "<actual UTC ISO timestamp after the holdout seal>",
  "holdoutSealSha256": "<manifest.contentSealSha256>",
  "sourceFiles": [{ "path": "src/forge/product/runtime.ts", "sha256": "<exact byte hash>" }],
  "notes": "<optional check evidence/source commit>"
}
```

Every current `src/forge/product/**/*.ts` file and `src/forge/executable.ts` must be listed. Additional source/configuration files are encouraged. The runner verifies hashes before opening the corpus and again after evaluation. Results record source-freeze and runner hashes. Hash changes invalidate attribution to a stable frozen implementation.

After the architecture owner explicitly authorizes execution:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/evaluate-core-holdout.ts --freeze=artifacts/core-source-freeze.json --provider=recorded
node node_modules/tsx/dist/cli.mjs scripts/evaluate-core-holdout.ts --freeze=artifacts/core-source-freeze.json --provider=local --limit=20
```

The first mode includes all 100 immutable authored recordings and does not call inference. The second uses `GroundedMissionModel(new LocalStructuredTransport())` against an existing loopback local model. It never downloads or starts a model. A deterministic stratified subset, if specified, is selected and written to `run-plan.json` before oracle parsing or outcome inspection. No remote provider, cloud, Google, Spotify, external MCP, or Docker path is available. Outbound fetch is blocked; only loopback fetch is admitted for the local inference mode. Sandbox execution explicitly uses the existing local process backend.

The handler layer uses descriptor/schema grounding and generic constant/list/append/update/artifact operations. Actual local files use the real WorkspaceConnector with public seeded immutable document IDs, preserving real parsing, saving, hashing, outbox behavior, and committed-artifact verification. The wrapper identifies all fixture execution as test mode. Synthetic calendar fixtures explicitly authorize writes in their fixture-only consent constraint. This grants no real Google access.

Installed fixtures are compiled, tested, and replayed through ProductRuntime with a separate recorded installer provider. Validated tools receive their predefined fixture identity and a recomputed ordinary approval hash, then pass normal exact-permission approval. Setup never executes their side effects. Setup problems are reported as fixture-invalid, retained in the total denominator, and distinguished from mission execution failures.

The mission provider never reads the oracle. Recorded responses are returned unchanged, tried once, and never repaired or augmented by host code. Legacy missing postconditions and route-contract gaps remain visible failures/limitations. A genuine local provider may use its own bounded normal repair path, with each stage request/response and timing retained.

Each mission uses an isolated persistent LocalStateStore. Only Date defaults/Date.now are controlled for its deterministic fixture clock; wall-clock timing uses performance.now. The initial event is repeated to check deduplication, then the state and fixture ledger are serialized and reloaded into a fresh store/runtime. Repeating the initial event after reload checks durable idempotency. Scheduler mutations update fixture tables, and ticks go through the actual ProductRuntime.tick path. A tick that produces no execution fails. The runtime chooses its own durable scheduled event identity; the corpus tick ID identifies the evaluator stimulus. Both repeat ticks and repeat actual event IDs must avoid duplicate writes.

Outputs include the immutable selection plan, per-case results, raw captured product/fixture evidence, exact provider inputs/outputs for local runs, partial progress, final metrics, source-freeze validity, latency percentiles, and failures. An `executionDoneWithFailedGoal` counter is kept separately from `verifiedWithFailedGoal`; execution status is never described as proof of a goal. Runtime verification can remain unverified while the independent oracle confirms the synthetic goal, particularly for legacy authored outputs without explicit postconditions.

Natural-language connection, clarification, and refusal predicates use a disclosed lexical concept heuristic and are marked `semanticHeuristic`. They support triage rather than claiming a general semantic proof. Raw explanations are preserved for review. Retrieval metrics report candidate counts and distractor coverage; small seeded candidate sets cannot establish difficult semantic-retrieval quality. Recorded mode does not measure fresh intent understanding or generation quality. Exact independent data postconditions and permissions remain mandatory for mission success.

No case has been executed merely by preparing or typechecking this runner. `--help` does not open the sealed files. Generic fixture unit tests use separate tiny data and make no provider calls.
