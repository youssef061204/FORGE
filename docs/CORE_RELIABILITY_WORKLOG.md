# Core reliability worklog

Status cutoff: November 16, 2026. This is an implementation/evidence log, not a claim that the reliability objective is complete.

## Constraints

- Incremental paid cloud/model budget: **$0.00**. No new Bedrock or other paid calls, no later spending request, no cloud resources or GPU launch-policy workarounds.
- Keep the existing product surfaces. No Lab, ML subsystem, simulation feature, framework replacement or large UI redesign.
- Preserve the original 18 prompts, expected outcomes and success criteria. Keep historical live provider evidence separate from current offline/local evaluation.
- Seal a larger independent corpus before architecture edits. Do not expose sealed expected answers or authored outputs to implementation providers.

## Baseline retained

The October 23 cached-local result is **7 passed, 9 failed and 2 prerequisite-blocked out of 18**. The November 12 freeze contains 148 files/4,546,421 bytes. Corpus SHA-256: `f8284be04ceda8c9ac477be34f399c58872f6afc71e1142019b2a811e4070361`. Manifest SHA-256: `f33dd503e421bdab241a8e432bb33f5bb8bec5f2245727701e3142cda0a00cdb`. [Snapshot](../artifacts/core-reliability-baseline-2026-11-12/manifest.json).

The [baseline audit](CORE_RELIABILITY_BASELINE.md) explains all 18 cases. Earliest established causes among the eleven nonpasses: four compilation failures, two authored-test/source disagreements, one source/header defect, two missing-service routing failures and two upstream compilation dependency blocks. All seven committed outputs were independently rechecked. No original case/evaluator criterion was relaxed.

## Holdout precommitment

A separate evaluation agent authored/sealed 100 mission rows, 100 independent expected-outcome rows and 100 separate authored offline model outputs. Creation was `2026-11-15T02:23:55.873Z` (November 14 in Toronto). Seal: `a11da48b82f9db9e171237325924815684eca36d606e63ffb57313d459f1dad9`. [Manifest](../evaluation/core-holdout-2026-11-12/manifest.json), [public protocol](../evaluation/core-holdout-2026-11-12/PROTOCOL.md).

The directory retains its November 12 preparation name; its manifest records actual creation time. Category totals are 20 local files, 8 Gmail, 8 Calendar, 10 cross-service, 10 monitoring, 15 installed-program, 8 missing-connection, 8 clarification, 5 unsupported and 8 unseen-API cases. This is developer-role separation and precommitment, not independent human blind review. No case execution is recorded at this cutoff. Implementation authors have not opened sealed cases/oracles/recordings/authoring code.

## Implemented source changes

- Added mission-plan schema, catalog-derived requirements/operation/permission validation and explicit no-action dispositions before implementation generation.
- Added provider-independent structured generation transport, cached local model path and free-only guarded Bedrock interface. No paid dispatch was run.
- Added generic typed IR, schema/path/type analysis, independent reference evaluator and hygienic lowering to the existing strict executable contract. Routine file serialization is compiler-owned; custom TypeScript remains available for genuine custom computation.
- Added host compiler-consistency fixtures, explicitly distinct from independent intent verification.
- Added optional hash-covered postconditions and IR representation metadata, committed Workspace readback, verification status and bounded hooks. Committed/uncertain effect history remains protected against duplicate writes.
- Added up to three explicitly bounded attempts on the new local compiler, structured diagnostics and stage timing retention. Older model defaults remain compatible.
- Added explicit PRODUCT/DEVELOPMENT/TEST selection and rejection of recorded injection outside TEST. Normal PRODUCT uses a genuine provider interface.
- Expanded installed-tool retrieval metadata and excluded paused ordinary reuse candidates. Added small failure/outcome copy rather than a new interface.

## Verification correction found during audit

An independent source audit found that an earlier implementation could treat any successful readback on a connector as confirmation for every opaque acknowledged write on that connector. Before holdout evaluation, this promotion was removed. Readback predicates can fail or pass independently, but an opaque side effect remains unverified without a trusted effect-specific confirmation hook. The new test now expects unverified execution in that case. Original 232 tests/old corpus criteria were not changed to promote results.

The audit also identified a contradictory missing requirement for an exact connected operation. Grounding now returns a typed correction diagnostic rather than unnecessarily requesting that already-connected resource.

## Evidence currently earned

| Check                                                 | Recorded status                                       | Scope                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Original tests before architecture work               | 232/232 passed                                        | Existing regression baseline.                                                                                                   |
| Interim integrated unit run                           | 322/322 passed across 32 files                        | [JSON](../artifacts/core-reliability-2026-11-16/integration-unit.json); before final generic-readback tightening.               |
| Post-tightening focused tests                         | 28/28 passed, implementation-owner report             | Planning, grounded integration and outcome verification; final aggregate still pending.                                         |
| Comparison evaluator                                  | Semantic decoder functions/success predicate retained | [Provenance](../artifacts/core-reliability-2026-11-14/development-evaluator-provenance.json); original source/corpus unchanged. |
| Sealed corpus static validation                       | 100 cases/oracles/recordings sealed                   | No runtime/model evaluation implied.                                                                                            |
| Actual local development pilot                        | In progress                                           | Two cases do not establish the full 18-case result.                                                                             |
| Mutation sweep                                        | In progress                                           | Designed as 25 control/defect families × 3 variants; no detection score yet.                                                    |
| Full 18-case rerun                                    | Pending                                               | Frozen development set, actual cached-local provider.                                                                           |
| Sealed 100-case recording run                         | Pending source freeze                                 | Authored outputs through the real runtime; not fresh generation.                                                                |
| Fresh cached-local holdout subset                     | Pending source freeze/selection                       | Must keep its denominator/provider/timings separate.                                                                            |
| Final typecheck/lint/build/browser/deployment/restart | Pending                                               | Earlier release evidence is historical.                                                                                         |

## Required final evidence

Record the implementation-tree hash and explicit freeze timestamp before unsealing; verify all sealed hashes. Preserve the first run, including failures. Subsequent changes/reruns are development follow-ups. Report route, exact authority, compiler/admission checkpoints, execution, runtime declared verification, external oracle postconditions, persistence, reuse/extension, duplicate effects and both execution/verified false-success discrepancies with explicit denominators.

Measure p50/p95 per entered stage and end-to-end scope. Do not insert zero timings for stages never reached or count reused historical compilation as a new compilation. Keep original sealed pass semantics and a stricter full-workflow metric separate if a failed returned execution nevertheless leaves the desired state. Preserve lexical semantic-proxy limitations for refusal/clarification text checks.

The final report is [CORE_RELIABILITY_REPORT.md](CORE_RELIABILITY_REPORT.md). Its pending result sections must be completed only from executed artifacts. Existing NEXT_REPORT/VERIFICATION historical content is not modified by this documentation task.
