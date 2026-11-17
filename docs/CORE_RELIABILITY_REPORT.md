# FORGE core reliability report

**Working report — November 16, 2026. Acceptance is still open.** The original result remains **7 passed, 9 failed and 2 blocked out of 18 missions**. Systemic changes are implemented and focused tests pass, but the complete development rerun, sealed holdout, mutation sweep and packaged acceptance must finish before this report can claim improved mission reliability. This pass has an absolute **$0 incremental paid cloud/model budget**. No new live Bedrock benchmark is authorized.

Evidence classes stay separate throughout this report:

- **Original local inference:** the retained October 23 run using cached `qwen2.5:7b-instruct` weights, frozen on November 12.
- **Current cached local inference:** actual new loopback-model planning and implementation, with fresh results pending below.
- **Authored-recording integration:** independently authored fixed model-output fixtures through the real compiler, broker and stores. This tests the surrounding system; it does not measure fresh intent understanding or model generation.
- **Mutation execution:** deliberately defective plans/programs tested against independent state expectations. Repeated variants are reported by family as well as by case count.
- **Historical live Bedrock:** earlier genuine paid-provider evidence, preserved and dated. It is not added to current offline or local-inference denominators.

## A. Original 7/18 failure analysis

The [complete baseline report](CORE_RELIABILITY_BASELINE.md) covers every original request, available resource, intended and actual route, proposed source, first failing stage, retry evidence and exact artifact. The unchanged [baseline snapshot](../artifacts/core-reliability-baseline-2026-11-12/manifest.json) contains 148 files and 4,546,421 bytes, including the original corpus/evaluator and all retained local-synthesis evidence.

| Original non-pass group           | Cases | Earliest established cause                                                                                                      |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------- |
| Strict compilation                |     4 | Parameter redeclaration, missing accumulator, array indexing on object rows, or an invented extra data wrapper.                 |
| Authored test/source disagreement |     2 | Malformed join expectations or an unnecessary terminal-newline disagreement. These were not established codec/compiler defects. |
| Incorrect source behavior         |     1 | A CSV result omitted its header; its first data row became the parsed header.                                                   |
| Missing-service routing           |     2 | The plan substituted a local file for an unavailable Calendar/email effect. This preceded later source errors.                  |
| Upstream dependency block         |     2 | The invoice prerequisite failed, so reuse and extension never reached their own routing stages.                                 |

All seven committed outputs matched the unchanged independent expectations. Failed and blocked cases recorded no write receipts. Fourteen of fourteen final file declarations derived the expected permissions even when source admission failed; the published 7/18 permission-result count must not be misrepresented as eleven proven permission-inference errors. [Baseline definitions and evidence](CORE_RELIABILITY_BASELINE.md).

## B. Failure taxonomy

The taxonomy separates intent, resource discovery, retrieval, routing, planning, source construction, compilation, contracts, permission inference, connector execution, state/context, repair, verification, false success, unsupported environments and evaluator defects. The first causal failure takes priority over later gates. For example, a missing Calendar action is a routing failure even if malformed source subsequently fails compilation.

The eleven original non-passes classify as **G compilation: 4; M authored-oracle verification: 2; F source behavior: 1; D routing: 2; upstream-G dependency blocks: 2**. Secondary source/contract/repair defects can coexist. No concrete original evaluator bug, live connector outage or completed-output false success was established. A correctly explained missing resource would have counted as success; neither original missing-service case did that. [Full A–P definitions](CORE_RELIABILITY_BASELINE.md).

## C. Architectural root causes

Three responsibilities were unnecessarily coupled. The model had to choose the required effect, author synthetic expected outputs, and write all TypeScript/serialization details before the system could determine whether the request was feasible. Operation existence alone could not detect that a valid local save was the wrong effect for an external-service request. Model-authored tests could contradict otherwise plausible source. A bounded retry often received the same broad source problem and repeated it.

The new boundary is **requirements → grounded plan → typed implementation → compiler/sandbox/replay → exact approval → effects → committed-state checks**. This moves unavailable authority and incomplete plans ahead of implementation and moves routine language/encoding mechanics into a generic compiler. It does not solve natural-language intent perfectly; the independent mission evaluator still determines whether the chosen plan actually satisfied the request.

## D. Changes made

Implemented changes are:

- A versioned mission-plan contract and catalog-derived feasibility checks before implementation generation.
- A provider-independent structured transport and compiler, with cached local inference and a cost-blocked Bedrock boundary.
- A hybrid representation: generic typed IR for ordinary relational/scalar/text programs, with custom TypeScript retained for computation the IR cannot express.
- Host-generated compiler-consistency fixtures and a separate reference evaluator on the IR path, replacing model-authored CSV/JSON test strings for that path.
- Hash-covered postconditions and persisted IR metadata; committed Workspace readback; explicit verified/failed/unverified outcome evidence.
- Explicit PRODUCT/DEVELOPMENT/TEST selection, guarded recorded-response injection, structured repair diagnostics, up to two bounded corrections for the new local compiler, and stage timing retention.
- Installed-tool retrieval using read/action/permission/trigger/output metadata, plus exclusion of paused tools from ordinary retrieval.
- Small outcome-copy changes: failed generation says no working tool was installed, and unverified execution is visible. No new product surface was added.

Primary implementation: [planning](../src/forge/product/planning.ts), [grounded compiler](../src/forge/product/grounded-model.ts), [transport](../src/forge/product/model-transport.ts), [IR compiler](../src/forge/product/ir.ts), [runtime](../src/forge/product/runtime.ts), [verification](../src/forge/product/verification.ts).

## E. What was deliberately not built

No new Lab, ML subsystem, simulation feature, agent framework, cloud deployment, paid provider sweep, Spotify integration or major UI redesign was added. No operation or plan template dispatches on benchmark IDs or request phrases. No sealed expected result is intended as planner input. The optional CUDA bridge remains outside this reliability pass; its previous launch-policy issue is not being worked around.

The project retains its existing broker, sandbox, MCP, persistence, versions and research facilities. Those systems support the central software-building loop; their historical metrics do not substitute for current mission-completion evidence.

## F. Interactive product mode

The source now defaults `FORGE_APP_MODE` to **product**. `FORGE_PLANNER_PROVIDER` selects **local**, **bedrock** or **offline** independently of the old fixture facilities. PRODUCT uses the actual provider interface; it does not select a keyword fixture planner. Recorded responses require explicit **test** mode, and TEST generation is prohibited in a packaged production server. [Mode selection](../src/forge/product/runtime-mode.ts).

The local provider labels itself **Local generation**. Configured Bedrock labels itself **Live generation · Amazon Bedrock**, but the current free-only policy blocks paid construction/dispatch before credential resolution. There is no fallback that claims Bedrock ran. Legacy `FORGE_RUNTIME_MODE=fixture` remains available for reproducible older facilities; it no longer describes the normal interactive planner. Packaged deployment of this revision is still pending acceptance.

## G. Resource discovery

Connectors expose identity, connection status, binding, read/write operations, exact input/output schemas, permission, side-effect level, idempotency and constraints. The normalized catalog derives **exposes**, **requires**, **consumes** and **produces** relationships from those contracts. It is used for validation, not as another user-facing graph. [Catalog and grounding](../src/forge/product/planning.ts), [connector fabric](../src/forge/product/fabric.ts).

Only connected operation contracts enter the narrow implementation choices. An essential missing operation cannot be replaced by an unrelated connected action. Resources exceeding the bounded compiler context are reported as unsupported within this compiler rather than fabricated as usable operations. Discovery success must be measured against the supplied registry; returning a schema-valid catalog alone does not prove that the user’s required capability was understood.

## H. Router

The supported dispositions are REUSE, COMPOSE, EXTEND, SYNTHESIZE, CONNECT, CLARIFY and UNSUPPORTED. OPTIMIZE is represented but cannot fabricate a specialized execution engine absent from the catalog. CONNECT requests the necessary unavailable resource and produces no program. CLARIFY asks the materially missing question. UNSUPPORTED explains a constraint without claiming completion.

Grounding checks operation kinds and identities, requirements omitted from the implementation, extra operations lacking a requirement, selected installed-program lineage and explicit edit targets. Contradictory claims that an exact connected operation is missing trigger correction. Routing still depends on the provider extracting the right requirements; that semantic step must be evaluated separately from structural plan validity.

## I. Tool retrieval

Retrieval remains local word TF-IDF plus character trigrams, not a neural embedding. It now indexes available read operations, permissions, trigger kind and declared output artifacts as well as name, description, goal, connectors and actions. Paused/revoked/rejected/review/superseded tools are excluded from ordinary candidate retrieval. Exact approved-goal reuse bypasses generation after hash/binding checks. [Retriever](../src/forge/product/retrieval.ts).

Current Recall@1, Recall@3, MRR and task-level reuse results are pending. Older retrieval numbers must remain dated and separate. A high-ranked candidate is not an automatic semantic reuse decision; the plan and runtime still validate selection and authority.

## J. Plan validation

The plan names its objective, essential read/write/compute requirements, unresolved questions, selected installed tools, constraints and implementation contract. The implementation declares reads, actions, exact proposed permissions, trigger, representation and expected outputs/postconditions. It is validated against the actual registry before source generation.

Checks reject invented or mismatched operations, missing required effects, unnecessary selected operations, excess/missing authority, invalid composition lineage and a custom-source selection without a specific reason. The validator does not run connector effects. This is a feasibility and consistency gate, not a proof that the provider’s objective accurately represents the user’s request. [Contract and checks](../src/forge/product/planning.ts).

## K. Synthesis representation

The IR represents ordered bindings, typed observation paths, literal/object/array values, scalar expressions, relational pipelines, guarded/iterated effects, result and bounded state. Generic operations include filtering, projection, flattening, joining, grouping/aggregation, distinct, stable sorting, slicing, record construction and JSON/CSV/text encoding. The compiler emits an ordinary complete `execute(input: ModuleInput): ModuleOutput` function; the existing compiler and sandbox still admit and run it. [Schema](../src/forge/product/ir-schema.ts), [lowering](../src/forge/product/ir-emit.ts), [reference evaluator](../src/forge/product/ir-evaluate.ts).

Hygienic names and trusted encoders remove parameter redeclaration and ad hoc CSV escaping/header construction from the model’s IR responsibility. Custom TypeScript remains possible for genuine custom computation. The original 16,000-character source, 4,000-node syntax, 20-effect and bounded worker limits remain. Host example/reference tests establish compiler consistency; they are explicitly **not intent proofs**. IR-versus-source reliability and timing measurements are still pending.

## L. Typed operation grounding

The compiler context contains exact declared observation schemas and a union of the selected action argument schemas. The IR checker rejects unavailable paths, forward bindings, incompatible arguments, unknown actions and budget violations before execution. The final emitted function also passes the existing strict TypeScript and prohibited-access checks. No raw credential, unrestricted connector handle, network or filesystem capability enters generated software.

Passing the same `ConnectorFabric.types` envelope to IR compilation and ordinary admission allows the bounded static compilation cache to reuse identical source/types. This caches compiler artifacts, not dynamic user observations. No measured latency gain is claimed yet.

## M. Repair

The new grounded local compiler permits an explicit maximum of three attempts: initial proposal, repair 1 and repair 2. Older models retain their previous defaults. Structured diagnostics preserve stage, code, message, optional path and retryability; an explicit nonretryable failure stops correction. Failed proposals receive no execution authority. Corrections undergo the complete gates again. [Runtime diagnostic/retry handling](../src/forge/product/runtime.ts).

The final report must distinguish first-pass **admission** from first-pass **compilation**. Reaching a final accepted tool after a repair does not establish which earlier compilation checkpoints passed. Exact per-attempt compilation/preflight rates require recorded checkpoints; where unavailable, they must be reported as unmeasured. Current first-pass/repair-1/repair-2/final counts are pending.

## N. Clarification

The plan can identify uncertain requirements and material user questions. A clarification needs a concrete unresolved choice and contains no generated program. The active tool and recent user requests are supplied as structured context rather than relying solely on a whole-conversation dump. [Planning memory and clarification](../src/forge/product/planning.ts).

Correct clarification counts as mission success when the independent oracle expects it. Refusing a feasible, sufficiently specified request is still a failure. Any holdout text checks based on lexical concepts must be disclosed as semantic proxies; they are not a rigorous natural-language judge. Current clarification accuracy is pending.

## O. Permission inference

The plan proposes permissions, and the trusted fabric independently derives the exact set from the declared operations. A mismatch is rejected before implementation. Runtime approval binds the exact program hash, operations, connection bindings, tests, postconditions and representation metadata. A new version does not inherit grants.

Report three different measures: proposed plan permissions versus derived authority; approved tool permissions versus the mission oracle; and actual execution authorization. The original baseline derived correct final file declarations in 14/14 cases but returned only seven admitted tools. Current whole-workflow exact-permission accuracy is pending; unavailable results are not automatically misclassified as wrong permission inference.

## P. Postcondition verification

Approved programs may declare expected effect counts/arguments, local artifacts and fresh declared-read schemas. Proposed outputs are checked before any write; committed outcomes are checked afterward. `run.verification` distinguishes **verified**, **failed** and **unverified**. `verified` means the declared contract passed; it does not prove arbitrary English intent. [Postcondition API and limitations](POSTCONDITIONS.md).

Artifact checks use the current run’s actual save effect and persisted output identity, bytes, content hash and decoded schema. Earlier files with the same name do not satisfy a missing current save. Missing/empty goal contracts remain unverified. Independent mission oracles remain necessary to detect a wrong plan that passes its own declared checks.

## Q. Side-effect verification

Workspace confirmation rereads persisted state after the write transaction. Connector acknowledgements alone do not prove that the resulting state changed. A successful generic readback no longer upgrades all acknowledged writes on the same connector: opaque effects require a trusted effect-specific confirmation hook, otherwise they remain unverified. A false or missing declared state condition fails the run. [Verifier](../src/forge/product/verification.ts).

Verification runs outside the write transaction, has a bounded deadline and never silently repeats a write. Failed checks preserve committed receipts and outbox reservations. Repeating the same event can recheck the outcome without resending already committed effects; uncertain writes remain blocked. No new live Google readback was added or exercised for bulk evaluation.

## R. Persistence

Programs retain source, version, parent/provenance, trigger, state, bindings, grants and evidence. Optional IR representation and postconditions are persisted and hash-covered when present; absent fields preserve older hashes. The durable execution plan/outbox retains event identity and committed/uncertain outcomes across runtime restoration.

The new integration tests verify persistent-state reuse after constructing a fresh runtime. A fresh packaged process/container restart remains a separate acceptance gate; an in-memory reconstruction is not presented as an OS-process restart. Historical October 23 packaged persistence is prior evidence, not a fresh result for this architecture.

## S. Reuse / extension

Exact-goal reuse keeps the installed source/hash and uses zero new generation. Semantic reuse must select an available installed program rather than fabricate a replacement. Extension names one existing parent and emits a complete revised implementation with fresh exact approval. Composition names at least two distinct installed programs; combining files or service operations alone is synthesis.

The original invoice reuse/extension cases were dependency-blocked and did not establish failures in those subsystems. The current full development rerun and sealed installed-program cases must report dependency coverage, reused identity, fresh authority, extension lineage and actual resulting behavior separately. Their results are pending.

## T. 18-mission before/after

The original corpus SHA-256 remains `f8284be04ceda8c9ac477be34f399c58872f6afc71e1142019b2a811e4070361`. Request wording, expected results and success criteria are unchanged. The new comparison runner changes provider wiring, evidence/provenance and output paths; its semantic decoder functions and success predicate were checked against the original. [Evaluator provenance](../artifacts/core-reliability-2026-11-14/development-evaluator-provenance.json), [comparison runner](../scripts/benchmark-core-missions.ts).

| Measure                             |                    Frozen baseline | Current complete rerun                                        |
| ----------------------------------- | ---------------------------------: | ------------------------------------------------------------- |
| Overall mission result              |    7 passed / 9 failed / 2 blocked | Pending; a two-case development pilot is not the full result. |
| File transformations                |                               7/14 | Pending                                                       |
| Correct missing-service decision    |                                0/2 | Pending                                                       |
| Reuse / extension exercised         |                       Both blocked | Pending                                                       |
| Planning attempts / chat calls      |                            26 / 52 | Pending                                                       |
| Successful time-to-review p50 / p95 | 19.805 / 43.131 s, seven successes | Pending, with the same denominator disclosed.                 |

The 18 cases informed development. Even after improvement, they are a development benchmark, not the sealed generalization result.

## U. Sealed holdout results

**Not evaluated at this report cutoff.** A separate authoring agent sealed 100 missions, 100 expected-outcome rows and 100 separately authored offline model responses before architecture edits. The seal is `a11da48b82f9db9e171237325924815684eca36d606e63ffb57313d459f1dad9`. [Public manifest](../evaluation/core-holdout-2026-11-12/manifest.json), [public protocol](../evaluation/core-holdout-2026-11-12/PROTOCOL.md).

Public families are local files 20, Gmail 8, Calendar 8, cross-service 10, monitoring 10, installed programs 15, missing connection 8, clarification 8, unsupported 5 and unseen API 8. These are synthetic fixture families; they do not imply real service accounts, physical actions or independent random population sampling.

The implementation authors have not opened the sealed cases/oracles/recordings/authoring file. An explicit source freeze and hash verification must precede unsealing. Report the first complete 100-case authored-recording run separately from any fresh cached-local subset, selected by a deterministic stratification before outcomes. Later fixes/reruns become disclosed development follow-ups. Authored recordings are not live/fresh model reasoning, and role-separated precommitment is not independent human blind review.

## V. Live Bedrock results

**New live requests: 0. New live benchmark: not run, prohibited by the $0 instruction.** There is no pending request for spending approval. The provider interface remains available in source, with free-only checks before credentials and dispatch; its changed path has no new live validation.

Previously verified live evidence remains [12 missions / 36 generated proposals](../artifacts/ml/program-synthesis.json), with 32 compiling and 31 passing initial execution, plus [six controlled repairs](../artifacts/ml/repair-benchmark.json), all six compiling and five executing after one repair. The [historical paid-request ledger](../artifacts/ml/paid-requests.json) contains 20 requests. Those October experiments used the earlier compiler. They establish that a genuine Bedrock path existed, not that the current holdout or changed IR path was evaluated on Bedrock.

## W. False-success rate

Do not infer false-success control from an execution status alone. The result tables must disclose at least:

- **Executed-success discrepancy:** tool cases returning execution `done` while the independent mission oracle fails, divided by executed tool cases.
- **Verified false success:** tool cases marked outcome `verified` while the independent oracle fails, divided by verified tool cases.
- **Full workflow success:** correct route/policy/permissions and independent postconditions, plus successful returned execution for tool cases. Report this alongside the sealed protocol’s original pass measure if they differ.
- **Mutation escapes:** defects that execute incorrectly, are incorrectly verified, or create business duplicates across distinct events, reported separately from schema/compiler rejection.

The original run had 0/7 wrong completed outputs, because all seven reached outputs matched. This tiny success-conditioned denominator is not a general zero-false-success guarantee. Current mutation and holdout rates are pending. Unverified legacy/opaque execution must remain visible rather than being recounted as verified mission success.

## X. Time-to-tool

Current stage and end-to-end distributions are pending. Retain planning, implementation generation, grounding/lowering, compile, synthetic validation/replay, committed-state verification, execution and first usable tool/output timing separately. Show p50/p95 and the number of observations for every metric. Missing/unentered stages remain absent or null; they must not be inserted as zero-duration successes.

Baseline all-case elapsed p50/p95 was 37.237/50.595 seconds, including failures and two short blocked dependencies. Successful new-tool review was 19.805/43.131 seconds over seven successes; installed execution was 71.877/104.064 ms. These scopes differ from packaged production/storage timings and from authored-response fixture latency. No improvement percentage is claimed before comparable current measurements exist.

## Y. Stage-by-stage metrics

| Metric                                       | Required denominator and interpretation                                              | Current evidence status                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Mission success                              | All selected missions; correct no-action outcomes count when independently expected. | Current reruns pending.                               |
| Correct refusal / connection / clarification | Cases independently requiring that disposition; report over-refusals separately.     | Pending; lexical text checks are proxies if used.     |
| Intent success                               | Fresh provider interpretation against an independent expected outcome.               | Cannot be inferred from authored recordings.          |
| Resource discovery                           | Needed exposed contracts found/available, with actual connection status.             | Structural tests pass; task-level rate pending.       |
| Route accuracy                               | All reached decisions and full selected corpus, with both denominators.              | Pending.                                              |
| Plan validity                                | Structurally grounded plans per returned planning attempt.                           | Focused tests pass; sweep pending.                    |
| First-pass compile / compile after repair    | Per-attempt compilation checkpoints, not final admission.                            | Report only checkpoints actually recorded.            |
| Admission / preflight                        | Sources passing complete admission/replay checks per build path.                     | Focused integration passes; sweeps pending.           |
| Exact permission set                         | Oracle exact authority per mission, distinct from host derivation correctness.       | Pending.                                              |
| Execution success                            | Returned successful execution per tool case; no-action cases excluded.               | Pending.                                              |
| Postcondition success                        | Independent oracle predicates and runtime declared verification reported separately. | Pending.                                              |
| Tool persistence                             | Required restored tool/trigger/source identity per eligible case.                    | Unit reconstruction passes; packaged restart pending. |
| Reuse / extension / composition              | Eligible case totals, exact identity/lineage and correct resulting behavior.         | Pending.                                              |
| False success / duplicate writes             | Counts plus explicit eligible denominators; do not hide semantic escapes.            | Mutation and holdout results pending.                 |

## Z. Tests

The [first integrated unit run](../artifacts/core-reliability-2026-11-16/integration-unit.json) passed **322/322 tests across 32 files**, including the original 232 tests. This preceded the latest tightening of generic-readback verification. A subsequent focused planning/grounded-compiler/outcome run passed **28/28** after that change, as reported by the implementation owner. Neither is a final frozen-release result yet.

New tests exercise grounding, cost-before-credentials boundaries, IR semantics/emitted-source consistency, schema/budget rejection, typed repair, optional metadata hash coverage, committed-state verification and recovery without duplicate writes. A readonly-array mutation test type error was fixed; final full strict typecheck/lint/build evidence is pending. Test count is supporting evidence, not the main mission-reliability result.

## AA. Regressions

Original corpus/evaluator and all prior artifacts remain preserved. Older absent-field hashes are kept compatible; new optional representation/postconditions change approval identity when present. Original Google, Twin/research, MCP and fixture facilities are retained, with no new live Google writes or token refresh needed for bulk checks.

The final acceptance still needs browser coverage for new synthesis, reuse, extension, multi-connector coordination, missing connection, clarification, generation failure, connector failure, revoked authority and restart/reuse. Final current Windows/Linux builds and state-preserving local deployment are pending. Prior browser/build successes do not automatically verify this changed architecture.

## AB. Current limitations

The acceptance headline is not yet earned: no complete current 18-case or sealed-100 result exists at this cutoff. The 18-case set informed development. The sealed set is synthetic and role-separated, not human-authored blind population evidence. Recorded outputs cannot measure fresh model quality. Correct program lowering and declared postconditions do not establish correct English intent.

The IR handles bounded snapshots and precomputed effect proposals. It does not fabricate dependent write-result dataflow or distributed execution. Files, source, syntax, state, effects and worker time remain bounded. Opaque connectors without trusted confirmation remain unverified even when a generic readback succeeds. Current app-level GPU, physical microphone transcription, native Alexa+ invocation, new live Google effects and fresh Bedrock reliability remain unverified in this pass.

## AC. Strongest current résumé metrics

**Final current reliability bullets are gated on executed results.** Do not present a target score or authored-response acceptance as natural-language model completion. Six final statements should be assembled from the completed development/holdout/mutation/persistence/retrieval evidence, each with its scope and source.

Already defensible engineering facts are the 100-case precommitted corpus, preservation/audit of all 18 original cases, generic typed program lowering under the existing 16,000-character/4,000-node/20-effect bounds, exact approval and committed-state verification, the interim 322/322 unit result, and preserved earlier live Bedrock evidence. These facts do not yet justify the desired headline “X% of N unseen missions in Y seconds.” Historical broader ML/GPU/security résumé metrics remain available in the older report, separately dated.

## AD. Exact URL to open first

The intended main URL is **<http://127.0.0.1:3108/>**. The current reliability revision has not yet completed packaged deployment/acceptance. Until that gate finishes, the URL’s existence or an older healthy container must not be represented as proof that it serves this new compiler. Final evidence must identify PRODUCT mode, actual selected provider, exact installed tool/output, process-restart persistence and preservation of existing release digests/state.
