# Frozen evaluation

The final expansion retains the frozen 49-case suite and adds `npm run evaluate:trust` as a separate 12-category evaluation. Its artifact is `artifacts/trust-evaluation.json`. It covers routing, generated-source behavior, exact permissions, replay accuracy on eight labeled emails, write interception, security denial, promotion, Capsule integrity/tampering, import trust reset, MCP execution and rollback. Categories overlap; do not add category counts into a synthetic accuracy denominator. Live Google correctness remains unverified without configured OAuth. Live Bedrock evidence is a separately recorded cloud request, not fixture model accuracy.

`evaluation/scenarios.json` contains 24 explicit requests with expected resolution, permissions and attack outcomes. `evaluation/boundaries.json` adds 25 adversarial/failure/lifecycle cases. `npm run evaluate` writes measured category-level results to `evaluation/latest.json`, including a digest of both manifests, timestamp, per-case latency, observations and errors. It uses the deterministic planner, fixture data and isolated worker; its MCP clients use linked SDK transports. Real HTTP compatibility is recorded separately in `artifacts/http-proof.json`.

For supported cases it compiles the request, checks expected permission sets, stages and validates a release, grants approval in the isolated test harness, registers its actual MCP tool and invokes it using the SDK. EXACT_MATCH, COMPOSE, EXTEND and SYNTHESIZE are covered. Forbidden email/application/purchase/secret requests must be rejected, and a hostile posting must remain data while an actual external-write attempt is denied by the broker.

Report categories separately, rather than advertising a single “100%” headline. The current measured results are:

| Category                     | Passed / applicable | What is measured                                                                                                        |
| ---------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Request schema validity      | 20 / 20             | Supported requests produce a valid DAG and canonical tool contract                                                      |
| Exact permissions            | 20 / 20             | No extra or missing permission relative to the case's declared expectation                                              |
| Installed execution success  | 20 / 20             | Approved tool invoked successfully through the actual MCP SDK registry                                                  |
| Forbidden requests           | 4 / 4               | Email, automated application, purchase and secret requests rejected                                                     |
| Prompt injection containment | 5 / 5               | Hostile posting variants remain data; separate actual exfiltration probes denied by the broker                          |
| Invalid specifications       | 6 / 6               | Unknown commands, cycles, extra/missing permissions, outbound URLs and approval bypass rejected                         |
| Failure containment          | 6 / 6               | Malformed input, missing resume, timeout, malformed source output, retry exhaustion and call budget stop before effects |
| Approval integrity           | 3 / 3               | Unapproved MCP call, wrong digest and post-approval tampering cannot execute/install                                    |
| Idempotency                  | 1 / 1               | Replayed event reuses execution and persists one notification                                                           |
| Installation                 | 20 / 20             | Supported proposals install after approval                                                                              |
| MCP registration             | 20 / 20             | Actual SDK tools/list includes installed contract                                                                       |
| MCP invocation               | 20 / 20             | Actual named SDK tools/call succeeds                                                                                    |
| Owner rejection              | 1 / 1               | Rejected proposal cannot install or register                                                                            |
| Duplicate installation       | 1 / 1               | Concurrent repeated approval commits one active release and audit                                                       |
| Version upgrade              | 1 / 1               | EXTEND installs v1.1.0 with document permission; registry/runtime use it                                                |
| Rollback                     | 1 / 1               | Approved v1.0.0 restored; registry and six-step runtime select it                                                       |
| Failed installation commit   | 1 / 1               | Injected transaction failure leaves review state without partial registration                                           |
| EXACT_MATCH classification   | 1 / 1               | Exact normalized replay resolves to the installed release                                                               |
| COMPOSE classification       | 3 / 3               | Related/new intent uses composition, including near-identical changed threshold and negation                            |
| EXTEND classification        | 2 / 2               | Cover letter and short threshold-change request target the installed career tool                                        |
| SYNTHESIZE classification    | 14 / 14             | New capabilities, including unrelated “add” and “also” requests, remain separate                                        |

There are 49 unique cases. The category rows overlap intentionally: a supported request contributes schema, permission, installation, registration, invocation and classification evidence; the original injection request contributes to both request and injection categories. Expected runtime failures count as boundary passes only when no side effects were persisted. Do not count their execution as successful. Supported request validations additionally ran 440 checks; lifecycle boundary validations are not included in that auxiliary total. Composition reused 16 nodes. These are not extra independent scenarios.

The five lifecycle cases were added before the submission-readiness run, preserving the existing 44. No expectations were changed in response to failures; the first 49-case run passed. Current frozen suite digest: `9ad25b253fe078d0329fb9b0bef2e92eacf17402b29c42ec2d09c78b7ff2cfde`.

The first expanded run exposed incorrect classification of a short extension request and a notification permission retained despite “do not notify me.” Both were fixed with those cases retained. Near-identical requests no longer bypass compilation through fuzzy exact matching; unrelated “add” requests do not automatically modify an installed career capability.

This is a small regression suite for a supported compilation grammar, not a statistical estimate of open-domain intent understanding or universal prompt-injection safety. Intent categories, defaults, skill matching and external adapters are controlled. The injection cases test a constrained DSL and its broker: they do not test whether a live LLM was persuaded by malicious text. Role-spoofing, tool-spoofing, indirect links and encoded instructions exercise that containment boundary. Bedrock quality and cloud latencies are not evaluated by this suite. `npm run verify:bedrock` is a separate account-backed smoke proof; injected Bedrock unit responses are labeled as such.

Validation layers: TypeScript strict check; ESLint; Vitest unit/SDK integration; Chromium browser lifecycle; independent HTTP MCP client; Docker sandbox smoke check; production build. Browser tests use fresh directories and do not modify the user's default data.
