# FORGE free local release — 2026-10-23

**Open <http://127.0.0.1:3108/>.** The selected file-to-tool product is deployed and verified, including real local-model generation, exact approval, actual MCP discovery/invocation, a downloaded result and persistence through a real process restart. The [release aggregate](../artifacts/next-release-verification.json) records `CORE_FLOW_VERIFIED_WITH_LIMITATIONS`, 31 artifact hashes and seven verified frozen source fingerprints. The [24-topic report](NEXT_REPORT.md) contains scope, failures and six traceable résumé bullets; the [175-second demo](NEXT_DEMO.md) includes a separate recording-container recipe that has not itself been started or rehearsed.

`FORGE_FREE_ONLY=true` remains enforced. `FORGE_RUNTIME_MODE=fixture` remains the legacy submission default; normal interactive generation uses the already cached `qwen2.5:7b-instruct` model through local Ollama. This work made **zero paid requests**, provisioned no cloud resource and used no cloud fallback. Historical AWS proofs below remain historical. Google reconnection was declined; current Gmail/Calendar status is `needs_consent` and no fresh Google read/write/refresh is claimed.

| Current check                   | Actual result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration                | **232/232**, 25 files; [JSON](../artifacts/next-unit-tests.json). A prior unrestricted-parallel timeout remains retained separately; production deadlines were not loosened.                                                                                                                                                                                                                                                                                                                             |
| Legacy Chromium                 | **20/20**, including seven injected speech/recovery flows; zero failures/skips/flaky retries; [stable result](../artifacts/legacy-browser-verification-2026-10-22.json). Fixture compilers.                                                                                                                                                                                                                                                                                                              |
| Actual local-model browser/MCP  | **1/1**, 73.006 seconds overall: T0 absent, approve, T1 present, invoke, independently checked download, refresh/reuse, generated v1.1.0 with grandTotal 107, fresh approval and revoked direct invocation; [proof](../artifacts/local-synthesis/browser-proof.json), [runner](../artifacts/local-synthesis/browser-report.json).                                                                                                                                                                        |
| Actual main production compiler | Two real local chats, 24.174 seconds inference, 6,614 input / 937 output tokens, schema validated; exact file-read/output access, approval gate, new MCP tool, correct downloaded 20/12/75 totals and duplicate-event suppression. Full automated proof 45.401 seconds; [production proof](../artifacts/local-synthesis/production-proof.json).                                                                                                                                                          |
| Actual process restart          | Changed container PID/start time; same installed hash, SDK invocation, download and duplicate-event suppression pass without new generation; [restart record](../artifacts/next-process-restart.json), [post-restart proof](../artifacts/local-synthesis/production-restart-proof.json).                                                                                                                                                                                                                 |
| Typecheck / lint / builds       | [Type generation/strict TypeScript](../artifacts/next-typecheck.log), [ESLint](../artifacts/next-lint.log), [Windows build](../artifacts/next-windows-build-final.log) and [Linux image](../artifacts/next-linux-build-final.json) pass. First Linux lockfile failure and narrow five-record dependency repair remain documented.                                                                                                                                                                        |
| Actual Docker workers           | All **three** workflow/module/City checks pass; [proof summary](../artifacts/next-sandbox-final.json).                                                                                                                                                                                                                                                                                                                                                                                                   |
| Fixture/trust regression        | **49/49** expectations, **440/440** executable checks, 20 capabilities; [evaluation](../evaluation/latest.json). **12/12** trust categories; [trust](../artifacts/trust-evaluation.json). These are separate from language synthesis or live Google effects.                                                                                                                                                                                                                                             |
| Controlled runtime/reliability  | **100/100** cases, 140 expected test writes, zero unexpected; 100 exact replay matches/zero external replay writes. Fifty unique events completed and fifty duplicates suppressed; four contained faults. Hand-authored recorded source/in-memory connectors, not 100 synthesized missions; [source/run manifest](../artifacts/product/runs/2026-10-23-final/manifest.json).                                                                                                                             |
| Final natural-language corpus   | **7 passed / 9 failed / 2 blocked out of 18**: seven of 14 file tasks, zero of two missing-service decisions. Six first-pass admissions, one repaired. **26 planning attempts / 52 local HTTP chats**, zero paid calls. Successful time-to-review p50/p95 19.805/43.131 seconds; all-case p50/p95 37.237/50.595 seconds. [Immutable final run](../artifacts/local-synthesis/runs/2026-10-23T04-51-19-671Z-0d98f42e.json). The corpus informed development; no blind held-out or broad reliability claim. |
| Production UI / Home voice      | Five routes at **1440×900 / 390×844**, ten viewport checks, no horizontal overflow/page errors/unexpected console errors; expected MCP GET 405 responses retained. [UI and reviewed screenshots](../artifacts/next-production-ui.json). [Injected Home recognition/media APIs](../artifacts/next-production-ui-voice.json) verify transcript, stop/recovery and preserved text after denial; physical speech remains unverified.                                                                         |
| State preservation              | All four pre-existing release digests, world hash `4653043e5cb93027eb6dd0ea8af34a7377e433ac2e56a36b3f096fdcadc53490` and dedicated Calendar configuration preserved. One actual generated tool added; [final state](../artifacts/next-main-final-state.json), [sanitized planner/resources](../artifacts/next-main-product-status.json).                                                                                                                                                                 |
| Fresh host CUDA component       | CPU/CUDA maximum TypeScript-reference error **4.55494×10⁻⁷**. Batch 1,024 observed **2,445.85 field futures/s** and a same-run CPU ratio 13.3188× on RTX 5050 Laptop GPU. Three-repeat timing varied and the host clock jumped during the run; no stable or whole-City speedup claim. [Dated component result](../artifacts/ml/gpu-futures-2026-10-23.json). Canonical October 10 `GPU_UNAVAILABLE` evidence remains unchanged.                                                                          |

The final corpus's **7/18** overall completion matches the preceding development run; it does not establish an improvement in broad mission success. Failures, two invoice-dependent blocked cases, model contexts, proposals, fixtures and source snapshots remain preserved. Missing-service classification, general multi-tool composition, physical voice, native Alexa+ deployment, universal generated-code safety and real-world infrastructure control remain unverified or inadequate. The completed controlled product journey is distinct from those claims.

Automatic approval review rejected starting the optional local CUDA bridge and its application verification command as **“blocked by policy”**, without a more specific reason. The command did not execute and no alternate launch was attempted. The [current application GPU bridge remains unverified](../artifacts/next-main-gpu-proof.json), despite the separate successful host component measurement.

The following historical verification content is preserved byte for byte. Its dates, providers, metrics and deployment statements describe those earlier runs.

# World request routing correction - 2026-10-08

The running local app at http://127.0.0.1:3108 now recognizes study/focus paraphrases including "studying". A request such as "Play music when studying" receives an explicit explanation that music playback is not connected, before calling any model provider or creating a partial routine. The World input also describes its available devices. Fixture mode remains the default; switching to Bedrock cannot supply a missing playback operation.

Verification: 115/115 unit/integration tests across 18 files; strict typecheck; lint and formatting of changed files; Linux production build; existing World lifecycle browser flow; new music-error/study-paraphrase recovery browser flow. The new browser test initially matched Next.js's route announcer as well as the app error; its locator was scoped to the Ask FORGE region and the test passed on rerun. The entire browser/ML suites were not rerun for this correction.

The packaged MCP endpoint returns the specific unsupported-playback error, the rendered page includes the device description, and all four currently installed release digests and the World hash were preserved through deployment and the rejected request. No paid AWS calls were made. Music playback remains unimplemented. Evidence: [world-request-verification.json](../artifacts/world-request-verification.json). Earlier acceptance results below describe their recorded builds.

# Executed verification ? 2026-10-08

The final existing-repository expansion is deployed and verified at **http://127.0.0.1:3108**. Features are frozen. The exact recorded acceptance is [final-system-verification.json](../artifacts/final-system-verification.json); the requested detailed [A?AR report](FINAL_ENGINEERING_REPORT.md) documents every subsystem and limitation. The default remains `FORGE_RUNTIME_MODE=fixture`; `FORGE_RUNTIME_MODE=aws` invokes the real provider and surfaces failures without fixture substitution.

| Final check                   | Actual result                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration suite        | 106/106 across 18 files                                                                                                                                        |
| Chromium browser suite        | 19/19, zero failures/skips/flaky retries; voice recovery, City, Lab, World, Live, MCP and model lifecycle                                                      |
| Full local benchmark          | All 31 stages completed; no paid requests by default                                                                                                           |
| Frozen evaluation             | 49/49 expectations, category-specific metrics in evaluation/latest.json                                                                                        |
| Trust evaluation              | 12/12 separate categories; injected Google contracts remain distinct from live reads/writes                                                                    |
| Typecheck / lint / formatting | Clean; final formatting record included in the system artifact                                                                                                 |
| Production builds             | Windows Next.js and Linux Node 24 builds pass after final forecast/store corrections                                                                           |
| Restricted Docker workers     | Workflow six steps, generated module, and City 27 actions/three steps pass; no worker credentials/network                                                      |
| Authenticated packaged MCP    | Actual SDK and 2025-11-25 Streamable HTTP; 401/403; missing tool at T0, present at T1, successful invocation, v1.1 and rollback; actual attack blocked         |
| Packaged Live                 | Replay, Shadow, exact grants, revoke, real local signature/tamper rejection and imported capsule with zero grants; no browser errors or mobile overflow        |
| Research production path      | Changed actual model predictions; exact full-forecast rollback; real +60-second shadow outcomes; 64-node OSM map requires full simulation; virtual camera runs |
| Actual CUDA owner API         | 1,000 current-observation field futures on RTX 5050; 3179ms HTTP wall time; paused City digest unchanged; read-only scope                                      |
| Production rendering          | Follow 60.04 FPS / p95 16.80ms; overview 60.00 FPS / p95 16.80ms; headless Chromium on this host                                                               |
| Main deployment preservation  | All three installed release digests, World hash and Google configuration exactly preserved; eight page/health routes return 200                                |
| Production dependency audit   | Zero advisories; the full install separately reported five high development advisories                                                                         |

The benchmark collected **640 whole episodes, 86,400 transitions and 276,480 forecast rows**, with 384 train, 80 validation, 80 held-out, 48 shift and 48 compositional episodes. Validation alone selects/calibrates models. [ML benchmark](ML_BENCHMARK.md), [metrics](../artifacts/ml/metrics.json), [dataset](../artifacts/ml/dataset.json), [artifact/source hashes](../artifacts/ml/evidence-index.json).

Actual repeated CUDA component measurements at batch 1024 reached 4,010.2 field futures/second and 9.93? the CPU component, with maximum TypeScript-reference error 4.55e-7. This does not establish a full-City speedup. The saved-fixture local-store correction measured 1.42? faster warm reads; state-copy isolation and external corrupt-state rejection pass. A same-node responder route defect was corrected and rerun: 96 actual executions on 24 paired scenes, zero sampled violations, 10.75-second mean simulated response improvement over current-demand optimization (paired 95% interval 3.25?18.75). These are bounded synthetic measurements. Failures and regression corrections are retained in [runtime corrections](../artifacts/final-runtime-corrections.json) and artifacts/final-baseline.

## Actual live Amazon Bedrock evidence

Exactly **20 authorized paid requests** executed: 12 synthesis, six repair, one complete City proof and one career capability proof. All used the normal SDK credential chain with profile `forge`, selected Region `ca-central-1`, inference profile `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. No credentials are logged. The durable ledger rejects additional requests at the cap.

- City compiler request `9b980d36-b2e3-412d-9a5f-bdb680cb1a83`: 46,588ms compiler duration; 31,341 input / 4,080 output tokens; strict schema passed; actual generated source/Futures, approval, installation, SDK discovery and invocation. [City evidence](../artifacts/bedrock-city-proof.json).
- Career compiler request `7f132b73-7e03-4563-ad48-049ff52d942a`: HTTP 200, 14,078ms compiler duration; 3,709 input / 1,069 output tokens; ForgeSpec validation passed; 22 admission checks and installed MCP invocation passed. [Capability evidence](../artifacts/bedrock-proof.json).
- The 12 live synthesis missions produced 36 proposals: 32 compile, 31 initially execute. Six one-attempt repairs compile; five execute. All failures remain recorded. The 100 local template variants are explicitly separate from unseen language synthesis. [Synthesis/repair scope](PROGRAM_SYNTHESIS_BENCHMARK.md), [paid ledger](../artifacts/ml/paid-requests.json).

Google configuration is preserved, but the connector remains unauthenticated and Calendar write consent is false. Native Alexa+ deployment, authenticated Google reads/writes, physical speech hardware, TensorRT/custom kernels and real disaster validity remain **unverified**. Voice integration/recovery passes injected browser recognition tests. Z3 checks manually encoded bounded guards; it does not prove arbitrary generated TypeScript. RL superiority is not statistically established; the congestion camera head failed and is published. [Known limitations and unverified paths](FINAL_ENGINEERING_REPORT.md).

The following sections retain earlier, historical verification. Their dates, metrics and provider requests describe those earlier runs.

# Executed verification — 2026-10-06

## City and ten-feature Lab — 2026-10-07

New evidence adds to the historical checks below. Default submission remains FORGE_RUNTIME_MODE=fixture. Its City model is an explicit fixed development double; general free-form City synthesis is the actual AWS path.

| Check                                         | Executed result                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm test                                      | 92/92 tests across 15 files, retaining original Google, replay, World, Studio and trust checks                                                                                                                                                                         |
| npm run test:e2e                              | 18/18 Chromium flows, including spoken challenge interim/final behavior, nonce replay rejection, paired arena and authority-free restoration; final voice/Lab regression 8/8 also passes after digit-word support; physical speech APIs injected                       |
| npm run verify:city                           | Three actual fixture programs, 20 paired Futures each plus 20 baseline; exact admission, real SDK discovery/invocation and changed current weather preserved                                                                                                           |
| npm run verify:lab                            | Ten features at their applicable boundary; 60 actual experimental pairs; retained owner context; changed source v1.1; signed passport/tamper rejection; imported capsule with zero grants, 20 fresh local Futures, approval/execution; restore revocation and rollback |
| npm run verify:city:aws                       | Genuine Bedrock request through the actual City compiler, strict response/schema/source validation, three actual programs, 20 Futures each, owner approval and installed MCP invocation                                                                                |
| npm run build                                 | Windows production build passed; root, /city, /lab and both new API routes packaged                                                                                                                                                                                    |
| docker compose build                          | Linux Node 24 production build passed with the same routes                                                                                                                                                                                                             |
| sandbox:check / sandbox:module / sandbox:city | All actual Docker workers pass; City module and three-step DSL executed, 27 actions; no worker credential inheritance or network                                                                                                                                       |
| npm run evaluate                              | Frozen 49/49 expectations unchanged, including distinct schema, permission, invocation, injection, invalid specification, failure containment and classification categories                                                                                            |
| npm run evaluate:trust                        | 12/12 separate trust categories; injected Google contracts remain distinct from live writes                                                                                                                                                                            |
| Production HTTP/Live proof                    | Authenticated isolated Linux instance passes protocol/T0/T1/invoke/v1.1/rollback/actual attack denial; replay/shadow/grants/revoke/signature/tamper/UNTRUSTED import                                                                                                   |
| Production Lab boundary                       | Page 200; tokenless API request 401; hostile origin 403; disposable container removed                                                                                                                                                                                  |
| Main deployment                               | Existing internship-scout v1.2.0 and leaving-home v1.0.0 digests preserved; fixture default; Google configuration preserved                                                                                                                                            |
| npm audit --omit=dev                          | Zero production dependency vulnerabilities                                                                                                                                                                                                                             |

Latest actual City AWS evidence at 2026-10-07T23:26:16.129Z:

- Provider: Amazon Bedrock; normal SDK chain with profile forge.
- Selected Region: ca-central-1.
- Inference profile: us.anthropic.claude-sonnet-4-5-20250929-v1:0.
- Request: 0f2bb931-4b1a-4999-b354-2bd232071212; duration 44,969ms.
- Tokens: 28,346 input / 3,931 output; strict response validation passed.
- Three structurally different sources evaluated, 20 actual Futures each; passing release validation and installed tool city_policy_9f23ba3c invoked successfully.
- No credentials logged, no silent fixture substitution.

Artifacts: artifacts/bedrock-city-proof.json, city-proof.json, lab-proof.json, city-docker-proof.json, city-lab-http-proof.json, city-lab-live-http-proof.json, city-lab-packaged-boundary.json and city-main-preservation.json. Earlier verified career/World/deadline artifacts remain untouched; pre-City state and historical copies are retained in artifacts/city-baseline.

The main Google configuration is present, but its connector is not authenticated and Calendar write consent is false. **No live Google write or native Alexa+ client deployment is verified.** Voice tests prove browser integration, not a physical microphone/speaker. City infrastructure and Futures are simulated; zero sampled failures never establishes universal safety.

The original historical expansion evidence follows. [Concrete 28-point report](CITY_FINAL_REPORT.md), [ten additions](LAB.md), [175-second City plan](DEMO.md).

## Final expansion evidence

The final expansion adds executable Reality Replay, revocable connector grants and signed Capsules without replacing the engine. The retained and new suites pass **64 unit/integration tests, 15 Chromium flows, 49 frozen scenarios and 12 separate trust categories**. Fixture labeled replay is eight exact matches, three confirmed changes and seven proposed effects with zero external writes. These are constrained observed checks, not broad model/email accuracy.

**Google OAuth is not configured. No actual Google Calendar write is verified.** Google OAuth/read/write contract tests use injected responses. Local Ed25519 signing is real; KMS/S3 tests are injected and do not establish live AWS service use.

The new actual Bedrock executable proof succeeded at `2026-10-07T03:12:16.345Z` using `forge`, `ca-central-1`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. One Converse request in that passing run returned HTTP 200 in **18,608ms**, request `b99d53ec-ff24-4afb-b15c-dc4ba88d671f`, 3,119 input / 1,729 output tokens. ForgeSpec/source validation, 22 admission checks, fixture replay and installed MCP invocation passed. T0 contains ten fixed adapters without deadline_guardian; T1 adds it. Artifact: `artifacts/bedrock-live-proof.json`. Four earlier separately recorded candidates were rejected; no first-try success claim is made.

The original career and World AWS evidence below remains historical and valid. Default mode remains fixture; AWS failures surface without substitution. [Full final report](FINAL_EXPANSION.md), [Google setup](GOOGLE.md), [trust boundary](PROGRESSIVE_TRUST.md).

The generated module Docker proof passed with a real isolated worker, no network, read-only filesystem and no credential inheritance (871ms); the original workflow Docker proof passed six steps (531.57ms). Final packaged/runtime checks are described in the expansion report and artifacts.

| Final expansion command / evidence                              | Observed result                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                      | 64/64 across 12 files, including refreshed ETags across consecutive injected Calendar changes                                               |
| `npm run test:e2e`                                              | 15/15 Chromium flows; retained voice/World and new Live lifecycle                                                                           |
| `npm run evaluate`                                              | 49/49; frozen digest unchanged; categories remain separate                                                                                  |
| `npm run evaluate:trust`                                        | 12/12 category checks; eight labeled replay examples; Google explicitly NOT VERIFIED                                                        |
| `npm run typecheck`, `npm run lint`                             | Clean                                                                                                                                       |
| `npm run build`, `docker compose build`                         | Windows and Linux production builds pass; original and new routes packaged                                                                  |
| `npm run verify:http` on authenticated isolated Linux container | Protocol, T0/T1, six-step execution, v1.1, rollback, attack denial and auth/origin checks pass                                              |
| `npm run verify:live` on authenticated isolated Linux container | Browser/MCP replay → install → Shadow → exact fixture grants → invoke → revoke → signed export → tamper rejection → UNTRUSTED import passes |
| `npm run sandbox:check`, `npm run sandbox:module`               | Both real Docker worker paths pass                                                                                                          |
| `npx tsx packages/forgespec/examples/validate.ts`               | Reusable schema example passes                                                                                                              |
| Recorded Bedrock source revalidated under final strict compiler | Passes; no additional paid request                                                                                                          |
| `npm audit --omit=dev --json`                                   | Zero reported production dependency vulnerabilities at verification time                                                                    |

The packaged Live artifact `artifacts/live-http-proof.json` records actual tool lists, local signature/content hash, tamper rejection, revocation, zero imported grants, no browser errors, and no 390px overflow. Screenshots come from the production application, including `docs/images/live-replay.png`. Isolated proof containers are removed without affecting the main demo volume. Verifiers start their artifact as incomplete before claiming success.

Final authenticated packaged proofs passed at `2026-10-07T03:46:26.752Z` (HTTP lifecycle) and `2026-10-07T03:46:35.304Z` (Live lifecycle). The latter also proves Deadline Guardian is synthesized beside an existing Internship Scout rather than replacing it. The exported production Capsule passed the standalone offline verifier. Latest module Docker check: 779ms.

Dependency audit scope: the fresh full Linux install reported five high-severity advisories in the development dependency graph; the production-only audit reported zero. These are separate results. No forced breaking dependency upgrade was applied during this feature freeze.

The rebuilt main Compose server is healthy at `http://127.0.0.1:3108`; Live, Capabilities, Studio, World, Live API and health return HTTP 200. A before/after comparison confirms the existing installed release digests and World state were preserved exactly (`artifacts/main-preservation-proof.json`). Final formatting/typecheck/lint and Windows/Linux production builds pass.

The standalone reusable-spec example was also executed: `npx tsx packages/forgespec/examples/validate.ts` passed, reporting the canonical internship_scout tool, six operations and exact minimum permissions without starting a server or configuring AWS.

Results below are from this workspace. The repository's working compiler, broker, storage, registry, voice flow and existing tests were inspected and exercised before edits. Baseline: 38 unit/integration tests, 11 browser tests, 44 evaluation cases, Windows/Linux builds, Docker worker and authenticated HTTP lifecycle passed. The previous explicit wire profile was 2025-03-26; the installed SDK already supported 2025-11-25.

## Retained World visual pass: earlier verification

The World visual pass also passed the full retained suite: **51 tests, 14 Chromium tests and 49 frozen evaluation scenarios**, with typecheck, lint, formatting and Windows/Linux production builds. The browser flow now includes native evidence/mail/scene drawers, Study Mode's workstation avatar, Demo mode, actual World reset and reduced-motion endpoints. The scoped reset test proves career records/effects/audit survive and World tools disappear through actual MCP discovery. The authenticated production HTTP proof was rerun on port 3113; Docker worker execution passed six steps in 380.36ms. [Visual-pass files, screenshots and limits](WORLD_VISUAL_PASS.md).

The compiler, MCP lifecycle and AWS configuration were retained. This visual pass did not issue another paid Bedrock request; the two successful live request artifacts below remain the AWS evidence.

| Exact command                                                                                                          | Expected                                                 | Actual                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                    | Strict TypeScript clean                                  | Passed                                                                                         |
| `npm run lint`                                                                                                         | ESLint clean                                             | Passed                                                                                         |
| `npm test`                                                                                                             | All retained/new tests pass                              | 51/51 across seven files, including real MCP world execution                                   |
| `npm run test:e2e`                                                                                                     | Real UI, HTTP and voice boundaries pass                  | 14/14 Chromium tests, including the full World flow                                            |
| `npm run evaluate`                                                                                                     | All frozen category expectations enforced                | 49/49 scenarios; category breakdown below                                                      |
| `npm run build`                                                                                                        | Windows production build                                 | Passed                                                                                         |
| `docker compose -p forge-verification up --build -d --wait` with `FORGE_PORT=3111`                                     | Linux production build and healthy server                | Passed; isolated project/volume                                                                |
| `docker compose up --build -d --wait`                                                                                  | Final fixture demo healthy                               | Passed; http://127.0.0.1:3108                                                                  |
| `npm run sandbox:check`                                                                                                | Restricted Docker worker executes actual DAG             | Success, six trace steps; measured run 380.36ms                                                |
| `npm run verify:http` with `FORGE_VERIFY_URL=http://127.0.0.1:3111`                                                    | Packaged HTTP lifecycle and protocol proof               | Passed                                                                                         |
| `npm run verify:http` with isolated authenticated container at `http://127.0.0.1:3113` and ephemeral `FORGE_API_TOKEN` | Same proof plus auth status/origin enforcement           | Passed; latest artifact has authenticationStatusVerified=true                                  |
| `npm run verify:bedrock` with intended AWS configuration below                                                         | Resolve account credentials, then prove real compilation | Passed: one HTTP 200 Converse request, schema validation, 22 checks and six-step MCP execution |
| `npm run format:check`                                                                                                 | Repository formatting clean                              | Passed                                                                                         |

The final invocation of each command is reflected here; generated evidence lives in `evaluation/latest.json` and ignored local `artifacts/`. These are measured regression checks, not a certification claim.

## Protocol and lifecycle evidence

SDK: `@modelcontextprotocol/sdk` **1.32.1**, installed and locked. Negotiated protocol: **2025-11-25**. Transport: **Streamable HTTP**, stateless JSON response mode. Endpoint: `/api/mcp`.

Six protocol-level unit tests exercise the real SDK transport wrapper. Browser HTTP tests also exercise the Next route. Evidence covers initialization/version negotiation, capabilities, schemas, string/numeric request IDs, envelopes, method/tool errors, invalid JSON/messages/batches, Accept/content-type rules, notifications, unsupported versions, origin protection and stateless session handling. `tools.listChanged=false` accurately describes rediscovery; no server session ID is advertised. GET/DELETE return 405; notifications return empty 202.

The authenticated production-container proof at 2026-10-07T02:14:54.857Z recorded:

- T0: forge.build + forge.inspect, no internship_scout.
- Passing proposal with 22 executed checks; still absent before approval.
- T1: internship_scout present in actual tools/list.
- tools/call: success, six actual primitive steps.
- EXTEND: v1.1.0, eight steps, documents.write added after new approval.
- Rollback: v1.0.0, six steps, actual rediscovery and invocation.
- Attack: external_http.write denied by the real broker with one recorded denial.
- Unauthenticated GET/POST: 401 without WWW-Authenticate. Authenticated hostile Origin: 403.
- Compiler: deterministic-planner, zero model tokens. nativeAlexaClientVerified=false.

See `artifacts/http-proof.json`. The disposable authenticated container was removed. No token was printed or persisted. The Compose verification container was removed with `down` while preserving its volume. The demo's existing state was not used for automated approval.

## Browser, voice and runtime boundaries

The retained 13 browser checks plus one full World flow now total **14 passing Chromium tests**. World adds real HTTP build/approval, T0/T1 discovery, Leaving Home effects, denied unlock with the door unchanged, night-arrival Welcome Home effects, v1.1.0 conditional temperature/TV behavior, rollback and a 390px overflow check. Screenshots were taken from the actual UI, with animations disabled for stable captures.

Fourteen Chromium checks retain the full household/install/discovery/invoke/extend/rollback story, mobile overflow check, independent HTTP SDK client, and seven voice checks. Checks cover runtime metadata, actual build progress, Inspect/Reject, explicit 2025-11-25 route behavior and the new World lifecycle. The initial production protocol label was inspected with agent-browser, corrected to initialize from the connected transport, and covered by an assertion.

Voice tests inject microphone permission outcomes and recognition events into the actual React flow. They cover multi-result live transcription, typed draft preservation, stop, permission/network/start failures, unsupported previews, late permission cleanup, and leaving Studio. A dictated request reaches the real MCP compiler. Physical audio recognition and the browser's remote speech service still require manual rehearsal; no headless test claims that proof.

AWS mode was also launched in an isolated production container with the intended profile/region/model but no credentials. The real browser displayed Amazon Bedrock and its configured model; building produced “Could not load credentials from any providers” in the alert/conversation, with zero installed releases. It did not substitute the fixture compiler. Screenshot: `artifacts/aws-mode-failure.png`. The container was removed.

## Evaluation categories

World is tested separately from the frozen suite rather than inflating its category denominator. Four world integration tests use the real MCP SDK and process worker to verify generated installation, unapproved denial, eight-step state changes, replay idempotency, malicious unlock containment, the 30-minute condition, extension/rollback, welcome/study effects, invalid bounds and missing permissions. All 51 tests across seven files pass. World releases execute 23 checks; existing releases retain their 22 checks.

Frozen suite digest: `9ad25b253fe078d0329fb9b0bef2e92eacf17402b29c42ec2d09c78b7ff2cfde`.

| Category                                              | Passed/applicable    |
| ----------------------------------------------------- | -------------------- |
| Schema, exact permissions                             | 20/20 each           |
| Installation, MCP registration, MCP invocation        | 20/20 each           |
| Installed execution                                   | 20/20                |
| Forbidden requests                                    | 4/4                  |
| Prompt-injection containment                          | 5/5                  |
| Invalid specs                                         | 6/6                  |
| Execution failure containment                         | 6/6                  |
| Approval integrity                                    | 3/3                  |
| Event replay, owner rejection, duplicate installation | 1/1 each             |
| Version upgrade, rollback, failed installation commit | 1/1 each             |
| EXACT / COMPOSE / EXTEND / SYNTHESIZE                 | 1/1, 3/3, 2/2, 14/14 |

There are 49 unique scenarios, with overlapping category denominators. Supported request release validation adds 440 checks and composition reuses 16 nodes; neither is an extra set of independent scenarios. [Evaluation methodology/limits](EVALUATION.md).

## AWS configuration and remaining manual work

### Live World proof

With the same configuration below and `$env:FORGE_VERIFY_DOMAIN = 'world'`, `npm run verify:bedrock` passed on **2026-10-06 at 21:38:06 EDT** (`2026-10-07T01:38:06.142Z`). It invoked the actual `forge.build` compiler, not a standalone Bedrock script.

- Provider `bedrock`, profile `forge`, invocation region `ca-central-1`, runtime mode `aws`.
- Inference profile `us.anthropic.claude-sonnet-4-5-20250929-v1:0`.
- One Converse request, HTTP 200, **16,758 ms**, request ID `83e8aaaf-967e-4c63-b488-954855f28998`.
- Actual usage: **2,479 input / 1,440 output tokens**; estimated cost null.
- ForgeSpec, DAG and exact permissions validated; all **23 executable checks passed**; resolution `COMPOSE`.
- Release digest `f331680592a5b609f97871db0d39f12cc37f82ba0ac52de35a63303f433ae8ff`.
- T0: `forge.build`, `forge.inspect`; proposed `leaving_home` absent before approval. T1 includes the newly approved tool. Actual MCP call succeeded with **eight process-sandbox steps**.
- Persisted state: home → away, five lights off, door locked, 24°C → 21°C, computer/appliances off; illustrative energy 2.80 → 0.60 kW. Total verifier duration **17,414 ms**.

Evidence: `artifacts/bedrock-world-proof.json`, with credentialsResolved, requestSucceeded, schemaValidationPassed and passed all true. This is real AWS compilation with simulated world effects and linked in-memory MCP; fixture browser tests separately prove HTTP/UI behavior. No native Alexa or physical device claim is made. Clear `FORGE_VERIFY_DOMAIN` for the original proof below. Both genuine requests passed; AWS failures never substitute the fixture compiler.

### Original domain regression

Intended values, explicitly provided by the owner:

```powershell
$env:AWS_PROFILE = 'forge'
$env:AWS_REGION = 'ca-central-1'
$env:BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
$env:FORGE_RUNTIME_MODE = 'aws'
npm run verify:bedrock
```

The latest Internship Scout live proof succeeded on **2026-10-06 at 21:39:03 EDT** (`2026-10-07T01:39:03.959Z`), after adding World. The command above exited 0 and exercised `forge.build` → `ForgeService.propose` → `compile` → `BedrockModelProvider` → Amazon Bedrock Converse. Production and verification share the same SDK client factory, using the normal SDK credential chain with the named profile. No credentials, HTTP headers or raw model output were logged.

- Provider: `bedrock`; runtime mode: `aws`; AWS profile: `forge`; invocation region: `ca-central-1`.
- Inference profile: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`.
- Exactly one Converse request: HTTP 200, **13,114 ms**; request ID `012de1f3-be8d-48e7-92ac-1cbfc93a1ab6`.
- Actual response usage: **2,484 input tokens**, **1,082 output tokens**. Estimated cost remains null.
- ForgeSpec/schema, DAG, exact permissions and trusted MCP contract validation passed. All **22 executable validation/security checks** passed; resolution: `SYNTHESIZE`.
- Release digest: `fc1cda3f312e6b4dda906ce07e475e11e69fde16a6eb8d7dd8860b91733c6b9d`.
- T0: only `forge.build` and `forge.inspect`. The proposed tool remained absent before approval. After isolated harness approval, T1 included `internship_scout`; its actual MCP invocation succeeded with **six process-sandbox trace steps**. Total verifier duration: **13,816 ms**.

The measured result is recorded in ignored local `artifacts/bedrock-proof.json`: credentialsResolved=true, requestSucceeded=true, schemaValidationPassed=true and passed=true. Earlier attempts encountered missing credentials and then AWS project verification; neither was counted as success. The verifier permits one cloud request and disables SDK retries; invalid output or an AWS failure exits nonzero without switching to fixtures. The production compiler retains its bounded correction attempt for invalid output.

Fixture mode remains the guaranteed default (`FORGE_RUNTIME_MODE=fixture`); contradictory legacy MODEL_PROVIDER settings fail clearly. This live proof uses linked in-memory MCP transports, fixture source/effect adapters, process sandbox execution and isolated memory storage. It establishes real Bedrock compilation; it does not establish a native Alexa connection or a deployed cloud application. [AWS responsibilities/setup](AWS.md) · [Permitted simulator scope](ALEXA_INTEGRATION.md).

Remaining submission steps: physical voice rehearsal, final video recording/upload, GitHub repository publication/access, Devpost fields and owner eligibility declarations. No submission or external publication was performed.

## Material changes

- `src/forge/mcp-http.ts`, `mcp-registry.ts`, `http.ts`: single-message protocol boundary, truthful capabilities, progress build ID, bounded errors.
- `src/forge/service.ts`, `records.ts`, `compiler.ts`, `validation.ts`: genuine build stages/timings, durable rejection, idempotent approval, lifecycle execution events.
- `src/forge/config.ts`, `browser-mcp.ts`, `telemetry.ts`: explicit fixture/aws mode, actual negotiated version, redacted structured metadata.
- `src/app/api/{mcp,forge,health}/route.ts`: transport dispatch, guarded progress/rejection, configured provider metadata.
- `src/components/{studio,review}.tsx`, `src/app/{layout.tsx,globals.css}`: honest simulator framing, approval card, mode/model, expandable proof/events and consumer outcomes.
- `tests/{mcp-http,approval,boundaries}.test.ts`, `e2e/approval.spec.ts`, `playwright.config.ts`: protocol, owner lifecycle and mode regression coverage; original tests retained.
- `scripts/{verify-http,evaluate,evaluate-boundaries}.ts`, `evaluation/{boundaries,latest}.json`: latest protocol/rollback evidence, five frozen lifecycle cases, separate registration/invocation metrics.
- `compose.yaml`, `.env.example`: one-command healthy fixture packaging and intended nonsecret AWS configuration.
- README, MCP/Alexa scope/AWS/architecture/security/evaluation/demo/submission/verification/friction docs, ForgeSpec README: accurate launch, evidence, limits, reusable example and 175-second recording plan.

The voice implementation remains intact and its seven regression checks pass.

## Final demo state

FORGE World is available at http://127.0.0.1:3108/world. `/studio` and `/` retain the original experience. [World architecture and material files](WORLD.md) · [World-first 175-second demo](DEMO.md). Main additions are `src/forge/world.ts`, `world-planner.ts`, `src/components/forge-world.tsx`, `world-scene.tsx`, `src/app/world/`, `src/app/studio/page.tsx`, `tests/world.test.ts` and `e2e/world.spec.ts`. Shared spec/compiler/models/broker/service/validation/records and owner API were extended; the public ForgeSpec schema and Bedrock verifier were updated. The frozen 49-case evaluation digest remains unchanged.

Running Compose service: `forge-forge-1`, http://127.0.0.1:3108, healthy, fixture mode. The existing `internship_scout` v1.1.0 and `leaving_home` v1.0.0 releases are preserved. The visual pass did not reset the main demo; use Scene inputs > Reset World demo to prepare an actual new World take, preserving the career release. Start/update with `docker compose up --build`; stop with `docker compose down`, which preserves `forge_forge-data`. Earlier `forge-preview-20261006` is stopped, and its `data/preview` records remain untouched. Unrelated Atlas/LedgerMatch containers were preserved. Screenshots include actual attack, discovery, trace, extension, executions, household, mobile, submission preview, and AWS failure.
