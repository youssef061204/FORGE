# Final FORGE engineering report

Generated 2026-10-08T18:58:20.808307+00:00. Measured evidence from the existing FORGE repository.

## A. PRODUCT / UX

FORGE remains one product: ask for a missing function, build a reviewable program, test it, approve it, and invoke its new tool. CITY, LIVE, TOOLS and INSPECT are the main navigation. The technical inspector starts closed. Existing World, Studio and program-test routes remain accessible inside the workspace. Provider details and research metrics remain under Inspect. See [design language](DESIGN_LANGUAGE.md).

## B. PLAYER

A host-authoritative player walks with WASD/arrows, sprints with Shift, collides with buildings/river geometry and interacts within a bounded radius. E inspects nearby assets, M changes camera, Tab opens Inspect, Escape closes/pause controls, and Enter focuses conversation. Input sequence and host elapsed time prevent replay/teleport. Client prediction uses the same motion equations; typing clears movement. Unit and actual browser controls pass; physical keyboard/microphone hardware is not a test fixture.

## C. CITY ENGINE

The 2240 × 1600 synthetic City has 48 road nodes, 82 roads, 560 physical terrain cells, 30 grid nodes and 29 grid dependency edges. Vehicles, pedestrians, responders and buildings have authoritative movement, demand and damage. Canvas draws layered sprites, lighting, weather and cached scenery; trusted host state owns simulation truth. The imported map has its own bounds. [Engine details](CITY_ENGINE.md), [actual deployed counts](../artifacts/final-main-after.json).

## D. DISASTERS

Flood, wildfire, earthquake, tornado, blackout, storm, gas and traffic incidents visibly differ and change physical state. Water diffuses; fire consumes fuel and emits smoke; gas/smoke advect; wind/damage and road capacities affect movement; grid failure darkens buildings and signals. Backup generation can fail under damage. The equations are synthetic digital-twin models and are not calibrated engineering forecasts.

## E. DATASET

640 complete episodes, 86,400 authoritative transitions, 276,480 node/horizon examples and 121 observed temporal/graph features. Fixed whole-episode splits: 384 train, 80 validation, 80 held-out, 48 shift, 48 compositional. Observation origins precede targets at +30/+60/+120 seconds; IDs/seeds/future state are excluded from model inputs. Shift intensity/topology restrictions and held-out hazard pairs are recorded. [dataset.json](../artifacts/ml/dataset.json), [splits.json](../artifacts/ml/splits.json).

## F. WORLD MODEL

Persistence, moving average, Ridge, gradient boosting, temporal MLP, shared graph-feature MLP and independent neural heads were fitted/evaluated. Validation chooses each deployed regression output and calibrates risk/intervals. Held-out queue MAE 0.5836, delay MAE 4.156 seconds. Every target, horizon and episode-bootstrap interval is retained. A final audit corrected 30-feature lag offsets and the normalized +60-second adaptation condition; the affected benchmark was rerun. [world-model.json](../artifacts/ml/world-model.json), [inference-verification.json](../artifacts/ml/inference-verification.json).

## G. GRAPH ML

One-hop mean road-neighbor and grid-parent features feed an actually trained shared MLP. This is a GraphSAGE-style feature baseline; no recurrent learned message-passing stack is claimed. Queue MAE: shared graph 0.5870, temporal 0.6018, boosting 0.5836, independent heads 0.5993. Shared features do not imply superiority. OSM topology is outside training support. [graph-model.json](../artifacts/ml/graph-model.json).

## H. RL

Offline Double DQN trained a 6→12→2 signal policy on 156,672 transitions across 136 exploration episodes. Real weights compile into ordinary typed source; worker/broker gates remain mandatory. Six strategies ran on 24 paired full-City scenes. RL score delta against fixed: -0.000473 (95% interval [-0.012500000000000016, 0.013210227272727262]). Its 95% interval includes zero; improvement is not statistically demonstrated. Training cadence is 10 seconds, deployed evaluation cadence 40 seconds. Actual saved Bedrock programs were evaluated separately on the same scenes without new paid calls. [rl-training.json](../artifacts/ml/rl-training.json), [rl.json](../artifacts/ml/rl.json), [bedrock-control.json](../artifacts/ml/bedrock-control.json).

## I. OPTIMIZATION

SciPy/HiGHS executed 100 real binary MILPs: 50 uniform switch costs and 50 heterogeneous costs. The deployed signal controller uses the exact top-K solution for its bounded uniform-cost surrogate; heterogeneous costs require the solver. Learned-priority refinement remains bounded and produces ordinary source. Resource placement separately enumerates three sites among twelve using graph-distance demand costs. Neither solver proves optimality for the complete dynamic City. [optimization.json](../artifacts/ml/optimization.json).

## J. MULTI-AGENT COORDINATION

Five bounded rule agents handle ambulance, fire, police, grid and shelter decisions. Centralized versus decentralized execution was measured on twelve paired scenes through the real worker/broker. Strategic hazard ordering and tactical safe reachability are explicit, replaceable source. Agents are not independently learned. A separate Ridge demand model is actually trained; random, current-demand heuristic, exact bounded placement and learned demand placement run on 24 paired scenes. Learned placement reduced mean response time by 10.75 simulated seconds versus current-demand optimization, paired 95% interval [3.25, 18.75]. The corrected 96 executions have zero sampled constraint violations; an earlier invalid same-node route proposal and its initial benchmark remain archived in final-baseline. This is a regression comparison on the same frozen scenes, not real emergency response validation. Mobile-generator/shelter-supply movement has no actuator. [multi-agent.json](../artifacts/ml/multi-agent.json), [placement-training.json](../artifacts/ml/placement-training.json), [resource-placement.json](../artifacts/ml/resource-placement.json), [benchmark-supplement.json](../artifacts/ml/benchmark-supplement.json).

## K. COMPUTER VISION

The actual City renderer produced 1,440 RGB frames from 160 whole episodes and three virtual cameras. A two-convolution CNN receives image pixels only. Held-out: 20 episodes/180 frames. Flood F1 0.875, fire F1 1.000 with 9 positives, smoke F1 0.839, congestion F1 0.000 with 2 positives. The failed congestion head is published and labeled. Actual portable convolution parity and production browser inference pass; Pillow and browser resizing differ. No real camera validity/localization/mAP claim. [vision.json](../artifacts/ml/vision.json), [vision-inference.json](../artifacts/ml/vision-inference.json).

## L. SENSOR FUSION

Trained logistic heads combine calibrated pixel predictions, separate structured physical measurements and known quality flags. Camera-only, sensor-only and fused F1/Brier are compared across clean, missing, spoofed, delayed, obscured and held-out combined faults. The obscured CNN runs on obscured pixels; stale measurements come from earlier actual frames. Controlled fault flags are not an omniscient attack detector. Runtime camera inspection exposes these tests. [sensor-fusion.json](../artifacts/ml/sensor-fusion.json).

## M. ANOMALY DETECTION

A train-fitted Isolation Forest with validation-only calibration detects controlled corrupted telemetry. Held-out AUROC 0.7855, AUPRC 0.7584, recall 0.6535, false-positive rate 0.1167; 2880 positive samples out of 5760. Robust statistics provide a separate comparator. These are synthetic families, not a universal malicious-sensor detector. [anomaly.json](../artifacts/ml/anomaly.json).

## N. OOD / UNCERTAINTY

Validation-calibrated standardized observed-feature distance identifies low support; held-out episode flag rate 0.0750, shift flag rate 0.4583, compositional flag rate 0.6875. Detection is imperfect and does not certify reliability. Missing history and imported geometry force simulation fallback. A three-member whole-episode-bootstrap unsafe ensemble was compared/calibrated; selected for unsafe probability: False. Its disagreement can expand actual testing to forty; measured single-model validation performance remains authoritative for probability selection. [ood.json](../artifacts/ml/ood.json), [failure-ensemble.json](../artifacts/ml/failure-ensemble.json), [calibration.json](../artifacts/ml/calibration.json).

## O. GHOST FUTURE

The same City view can overlay +30/+60/+120 trained node forecasts with uncertainty and risk. Each projection is labeled FORECAST; observed state remains distinct. Asset panels show current power/load/depth/demand and projected values. Forecasts confer no capability permission and cannot authorize installation.

## P. GPU FUTURES

Actual CUDA/PyTorch executes on NVIDIA GeForce RTX 5050 Laptop GPU. TypeScript-reference maximum GPU field error 4.5549376481712756e-07. At batch 1024, throughput 4010.2 field futures/second, CPU-component speedup 9.93×, peak allocated bytes 115718144. Small batches can be slower on GPU. A production owner API actually sent 1,000 current-observation fields to the authenticated local GPU bridge in 3179ms HTTP wall time and left the paused City unchanged. Worker, broker, routes and full City stay CPU. [gpu-futures.json](../artifacts/ml/gpu-futures.json), [production bridge proof](../artifacts/final-research-http-proof.json).

## Q. MONTE CARLO

1,024 field futures vary hazard intensity under a stated seeded distribution. Bad-cell-fraction results: {'fieldFutures': 1024, 'seed': 904, 'target': 'Fraction of field cells with >0.7m water, >0.3 fire or >0.3 gas; not a full City mission score', 'mean': 0.005927385602678571, 'median': 0.0, 'p90': 0.024464285714285796, 'p95': 0.03214285714285714, 'p99': 0.03571428571428571, 'worst': 0.03571428571428571, 'cvar95': 0.033834586466165405, 'badCellProbability': 0.25}. Mean/median/tail quantiles/worst/CVaR95 refer to physical field thresholds, not full mission failure probability. Complete mission constraint rates remain actual worker/broker Futures metrics.

## R. ADAPTIVE ROLLOUTS

Actual unsafe candidates stop after at least five tests; conservative domination after ten cannot yield approval; eligibility requires twenty actual safe samples. OOD, ensemble disagreement or close measured outcomes increase the budget to forty. Six paired scenes with forty common disturbance seeds compare exhaustive/adaptive testing: 320/1200 actual tests saved (26.7%), winner agreement 83.3%, unsafe misses 0. Timing ratios and episode-bootstrap intervals remain in statistics.json. Saving is attributed to the tested allocation policy, not assumed ML causality; one mismatched winner is retained. [futures-benchmark.json](../artifacts/ml/futures-benchmark.json), [statistics.json](../artifacts/ml/statistics.json).

## S. ACTIVE LEARNING

Three matched seed trials compare 24 initial training episodes plus 24 whole-episode queries selected by three-model bootstrap disagreement versus random selection. Held-out data are never queried. Actual label counts include every observation origin and are saved separately per method. This fixed-budget experiment does not demonstrate sample efficiency at every target error and active selection does not win every seed. [active-learning.json](../artifacts/ml/active-learning.json).

## T. FORMAL VERIFICATION

Z3 executed seven manually encoded bounded host-guard obligations, plus an unprovable grid non-overload property with a concrete SAT counterexample. These prove the specified formulas, not source/SMT equivalence, arbitrary TypeScript, universal future safety or real infrastructure. Actual sampled Futures and the permission broker remain necessary. [formal-safety.json](../artifacts/ml/formal-safety.json).

## U. ADVERSARIAL FUZZING

300 concrete attempts across ten repeated schema/broker/physical-safety families were atomically rejected. Counts are not 300 independent natural-language prompt attacks. Frozen prompt-injection/exfiltration categories are separate; actual production security probe denial and unchanged City state are asserted. [red-team.json](../artifacts/ml/red-team.json).

## V. LEARNED ADVERSARY

An evolutionary search selects difficult genomes from actual full-City loss/failure. Twelve genomes across four generations use the same 48-case budget as random search. Every generated scenario, rejection and result is retained. This is evolutionary learning; no trained neural adversary is claimed. [learned-adversary.json](../artifacts/ml/learned-adversary.json).

## W. CAUSAL ANALYSIS

Six paired digital-twin scenes suppress actual grid, signal or population operations under identical disturbances. Measured score differences attribute effect within the synthetic intervention model; they do not identify effects in a real City. [causal.json](../artifacts/ml/causal.json).

## X. COUNTERFACTUAL EXPLANATIONS

The hospital-damage sweep evaluates values 0.0–1.0 in 0.1 steps and retains the first sampled failure. This is the smallest measured grid point, not a globally minimal change or a safety certificate. Existing Lab ablation/policy comparison retains actual paired rollouts rather than relying on an LLM explanation. [causal.json](../artifacts/ml/causal.json).

## Y. PROGRAM MEMORY

Retrieval is bounded to four current-owner installed records matching the exact environment, with source, goal and outcome hashes. The compiler can use their measured context; reuse, extension and composition retain source/schema checks, broker scope and fresh approval. Imported capsules inherit no grants. This is scoped evidence retrieval; no trained universal memory optimizer or demonstrated synthesis-rate gain is claimed.

## Z. SYNTHESIS BENCHMARK

100 deterministic template variants compile/execute locally; they are not 100 unseen language missions. Twelve distinct live missions produced 36 Bedrock proposals. Compiler acceptance, source errors and actual execution failures remain in the corpus. The recorded live result is 32/36 compile and 31/36 initial preflight execution. Success here is preflight, not admission or long-horizon goal satisfaction. Full City and career AWS/MCP proofs separately demonstrate approval/install/discover/invoke. [program-synthesis.json](../artifacts/ml/program-synthesis.json).

## AA. SELF-REPAIR

Six real paid repair requests cover syntax, type, runtime, timeout, critical power and disconnected routes against the immutable original contract. Six compile; five execute. The type-defect repair still fails on unavailable shelter. One attempt per defect is measured; two/three-attempt results remain unverified because the paid request cap is exhausted. Existing runtime repair is bounded and cannot expand authority. [repair-benchmark.json](../artifacts/ml/repair-benchmark.json).

## AB. META-CONTROLLER

The bounded rule controller chooses exact reuse, extension/composition, explicit learned/optimized host strategies, generation, more actual Futures or clarification. It integrates with the existing CityFoundry rather than creating another agent runtime. Trained meta-policy performance and universal automatic solver selection are unverified. Explicit host models are labeled HOST CONTROLLER and are not presented as Bedrock output.

## AC. MODEL ROUTING

Fixture default and AWS execution are explicit modes. One real inference profile is configured; task-specific host controllers and exact software reuse avoid unnecessary synthesis. No second available paid model, comparative routing experiment or fabricated dollar costs is claimed. The normal SDK credential chain is used; failures in AWS mode surface without fixture substitution.

## AD. MODEL REGISTRY / DRIFT / ROLLBACK

The adapted +60-second queue head trains on original training data plus 32 fresh shifted episodes, validates on eight and tests on sixteen untouched new episodes. Fresh held-out base MAE 0.8534, candidate 0.8165. Real runtime shadow predictions compare the same past observations at the first observation at/after +60 seconds. Production recorded 2 completed pairs: base queue MAE 0.6613, candidate 0.6671; the candidate was worse in this short runtime sample. Residual threshold 1.5 triggers review only. Production verifies actual head change, explicit promotion and exact rollback of every forecast value; the paused City remains unchanged. A final regression fix preserves observation history when switching model versions and prunes it consistently before either head uses it. Owner events record canonical model hashes; raw-file hashes use a distinct documented format. [model-registry.json](../artifacts/ml/model-registry.json), [runtime proof](../artifacts/final-research-http-proof.json).

## AE. OSM / REAL MAP

The cached central-Kingston [OSM API](https://wiki.openstreetmap.org/wiki/API_v0.6) extract retains 64 connected nodes and 65 edges from an original 82-node component, preserving intermediate bends. Owner selection checkpoints/revokes City authority; return restores the snapshot without resurrecting a deployment. © [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Screen-normalized geometry is real; traffic, buildings, weather, hazards and grid are synthetic. Imported topology forces full simulation. [real-map.json](../artifacts/ml/real-map.json).

## AF. EXTERNAL DATA EVALUATION

10320 actual NYC taxi observations from [Numenta NAB](https://github.com/numenta/NAB) are split chronologically for demand forecasting baselines. Actual held-out errors and predictions are retained. Features/units differ from Northbank, so neural-model transfer and real disaster validation remain unverified. Separate equal-size 192-episode domain-randomization ablations measure synthetic robustness. [external-eval.json](../artifacts/ml/external-eval.json), [domain-randomization.json](../artifacts/ml/domain-randomization.json).

## AG. ONNX / TENSORRT

The actual trained DQN exports to ONNX and executes through ONNX Runtime on batches 1/64/1024 with parity and repeated latency measurements. Installed providers: ['AzureExecutionProvider', 'CPUExecutionProvider']. TensorRT is unavailable; no TensorRT acceleration is claimed. Forecast trees stay portable TypeScript. [onnx.json](../artifacts/ml/onnx.json).

## AH. CUDA / GPU OPTIMIZATION

Profiling justified vectorized PyTorch field operations. CPU/reference parity, device timing, memory and small/large-batch behavior are measured. No custom CUDA/Triton kernel was implemented or claimed. The authenticated bridge is optional; missing hardware/configuration returns a clear unavailable result and the ordinary fixture app remains runnable.

## AI. PERFORMANCE PROFILING

Production Chromium viewport 1440 ? 900: follow view 60.04 FPS, p95 16.80ms over 671 frame samples; overview 60.00 FPS, p95 16.80ms over 900 samples. The observed scene had 55 vehicles, 64 pedestrians and 2 active hazards. Frame measurements use requestAnimationFrame on this host, not a display/hardware guarantee. Separately retained tick/field, sandbox, solver, ONNX, MCP and Bedrock timings identify their scopes. Full-City speedup is not inferred from GPU components. The final local-store correction reuses validated snapshots only while file identity/size/nanosecond timestamps match, returns isolated copies, validates external replacements and commits, and writes compact JSON. The recorded 16.6 MB synthetic-fixture comparison measured 1.42? faster warm reads; this is a component measurement, not a full-app speedup. See [store benchmark](../artifacts/local-store-performance.json). [production measurements](../artifacts/final-research-http-proof.json), [performance.json](../artifacts/ml/performance.json).

## AJ. BEDROCK

Exactly twenty authorized paid requests executed: twelve synthesis, six repairs, one complete City proof and one capability proof. SDK profile forge, selected Region ca-central-1, inference profile us.anthropic.claude-sonnet-4-5-20250929-v1:0. Latest genuine City compiler request 9b980d36-b2e3-412d-9a5f-bdb680cb1a83 took 46,588ms at compiler level; career compiler request 7f132b73-7e03-4563-ad48-049ff52d942a took 14,078ms. Schema validation passed before acceptance. Provider-meter timings differ slightly from enclosing compiler timing. Secrets are absent from artifacts and workers; AWS mode never silently falls back. [City proof](../artifacts/bedrock-city-proof.json), [capability proof](../artifacts/bedrock-proof.json), [paid-requests.json](../artifacts/ml/paid-requests.json).

## AK. MCP

Authenticated production verification uses the actual SDK and Alexa-compatible Streamable HTTP protocol, listing existing tools before a capability exists, compiling/testing, approving/installing, rediscovering and invoking the new tool. Extension/rollback and actual attack denial pass. Host signal/responder comparisons are exposed by forge.controller. Native Alexa+ preview registration/client invocation remain unverified; no native deployment is claimed.

## AL. GOOGLE LIVE

OAuth, Gmail/Calendar adapters, Deadline Guardian, Reality Replay, Shadow, scoped grants/revocation, signed Capsules and trust remain preserved. Production deterministic Live lifecycle and injected connector contracts pass. Main Google configuration survives deployment, but the connector is not authenticated and Calendar write consent is false. Actual Gmail reads/Calendar writes require completing OAuth consent; no real write is claimed.

## AM. TESTS

Recorded final checks:

- npm run typecheck: Passed; strict TypeScript
- npm run lint: Passed; no warnings
- npm run build: Passed; Windows Next.js production build after forecast-history and local-store corrections
- docker build -t forge-app:local -f infra/Dockerfile .: Passed; Linux Node 24 production build after forecast-history and local-store corrections
- npm run sandbox:check: Passed; actual Docker worker, six steps, 533.58ms
- npm run sandbox:module: Passed; actual restricted generated-module Docker worker, 889ms; no network/credentials, read-only filesystem
- npm run sandbox:city: Passed; actual City Docker worker, 27 actions and three steps, 1729ms
- docker compose -f compose.yaml -f compose.google.yaml -f compose.gpu.yaml up -d --wait --no-build: Passed; main healthy at 3108, all three installed release digests and World/Google state preserved; fixture default
- npx tsx scripts/ml/placement-benchmark.ts: Corrected same-node route proposal; rerun 96 actual worker/broker executions on the same 24 scenes; zero sampled failures
- npx playwright test e2e/ml.spec.ts: Passed; focused forecast promotion/rollback, OSM import and rendered camera
- .venv-ml/Scripts/python.exe -m compileall -q scripts/ml: Passed; research Python sources compile
- npx tsx scripts/profile-local-store.ts: Passed; five warm reads of a 16.6 MB saved synthetic fixture; 1.42x read throughput; exact state digest parity
- npm test: 106/106 passed across 18 files
- npx playwright test --reporter=list,json: 19/19 Chromium flows; zero failures, skips or flaky retries; seven voice integration/recovery flows
- npm run benchmark:forge: All 31 local stages completed with exit code zero; later route/store/history regressions separately documented; zero paid calls in default workflow
- npm run evaluate: 49/49 frozen expectations; schema, permission, injection, failure and classification categories reported separately
- npm run evaluate:trust: 12/12 categories; Google contracts/replay separate from authenticated real writes
- npm run verify:http on authenticated disposable Linux container: Passed; actual MCP SDK/wire negotiation, 401/403, T0/T1, 22 checks, invocation, v1.1, rollback and actual attack denial
- npm run verify:live on authenticated disposable Linux container: Passed; replay/shadow/exact grants/revoke/signature/tamper/UNTRUSTED import; mobile overflow false and no page errors
- npx tsx scripts/verify-research-http.ts on authenticated disposable Linux container: Passed; exact model rollback, +60-second shadow outcomes, OSM/OOD, actual 1,000-field CUDA request (3179ms HTTP), paused City unchanged; camera browser and frame metrics; no page errors
- npx tsx scripts/ml/verify-inference.ts: 24 world and eight policy samples pass Python/TypeScript parity; maximum forecast error 4.92e-7
- Actual CNN portable inference: Four actual pixel tensors pass PyTorch/TypeScript parity; maximum probability error 1.28e-8
- npm audit --omit=dev --json: Zero production dependency vulnerabilities; separate full install had five high development advisories
- Live Bedrock compiler/MCP proofs (recorded authorized requests): Real City/career AWS compilation, strict schemas, admission, tool installation/discovery/invocation in ca-central-1 via profile forge; 20/20 request cap used; no additional paid calls
- npm run format:check: Passed across the final source and documentation

Full benchmark stages all completed with exit code zero; the route correction was rerun separately and documented in benchmark-supplement.json. Browser fixtures use a separate store; approval harnesses use disposable authenticated containers, never the main data volume. The initial placement failure, browser weather-response timing failure and live program/repair failures remain archived. Failing results are not counted as passing evidence. Main deployment preserves all three installed capability digests, World state and Google configuration. Dependency audit found zero production advisories; the full install separately reported five high-severity development advisories.

## AN. FINAL MEASURED METRICS

| Measurement                          | Actual value    | Scope                                            |
| ------------------------------------ | --------------- | ------------------------------------------------ |
| Forecast queue MAE                   | 0.5836          | 80 whole held-out episodes                       |
| Forecast delay MAE                   | 4.1563          | 80 whole held-out episodes                       |
| Forecast congestion MAE              | 0.0615          | 80 whole held-out episodes                       |
| Forecast water MAE                   | 0.0017          | 80 whole held-out episodes                       |
| Forecast fire MAE                    | 0.0005          | 80 whole held-out episodes                       |
| Forecast smoke MAE                   | 0.0015          | 80 whole held-out episodes                       |
| Forecast power MAE                   | 0.0501          | 80 whole held-out episodes                       |
| Forecast hospitalDemand MAE          | 0.0001          | 80 whole held-out episodes                       |
| Forecast emergencyDemand MAE         | 0.0164          | 80 whole held-out episodes                       |
| Outage AUROC / AUPRC                 | 0.9952 / 0.8110 | 1310 positive node/horizon rows                  |
| Outage Brier / ECE                   | 0.0106 / 0.0090 | Validation-only calibration                      |
| Unsafe policy AUROC / AUPRC          | 0.9465 / 0.9217 | 107/192 positive program outcomes                |
| Unsafe policy recall / FNR           | 1.0000 / 0.0000 | Eight known program families; no universal claim |
| Adaptive tests saved                 | 26.7%           | Six paired scenes                                |
| Winner agreement / unsafe misses     | 83.3% / 0       | Six scenes, 40 common seeds                      |
| CUDA field futures/sec / CPU speedup | 4010.2 / 9.93×  | Component only, batch 1024                       |
| Camera flood / congestion F1         | 0.875 / 0.000   | 180 frames from 20 held-out episodes             |

Classification point estimates use correlated node/frame rows; whole-episode counts, positive counts, failures and regression/control bootstrap intervals must accompany claims. No aggregate '100% accuracy' statement is defensible.

## AO. RESUME EVIDENCE

[RESUME_EVIDENCE.md](RESUME_EVIDENCE.md) provides six candidate bullets traceable to dataset, GPU, camera, formal/broker and real Bedrock artifacts. Strongest claims concern measured scale and execution. Avoid claiming GNN superiority, significant RL improvement, whole-system GPU speedup, real camera/disaster validity, broad synthesis generalization or native Alexa deployment.

## AP. KNOWN LIMITATIONS

Synthetic disaster equations; one training topology; limited program/hazard families; sparse positive camera classes and a failed congestion head; imperfect anomaly/OOD detection; empirical adaptive selection mismatch; offline RL with deployment cadence mismatch; manually encoded SMT guards; bounded graph-hop placement; local single-player owner model; component GPU acceleration; deterministic fixture submission; template versus language synthesis distinction; no measured multi-model dollar-cost routing.

## AQ. UNVERIFIED PATHS

Native Alexa+ preview/client deployment; physical speech hardware/service reliability; authenticated real Google reads/writes; TensorRT/custom kernels; engineering-grade hazard safety; real camera data; Northbank learned-model transfer to external geography/data; independently learned responder agents; learned meta-policy; multi-model routing; two/three-attempt paid repair; movable generators/shelter supply optimization. These limitations remain explicit and do not invalidate the executed paths.

## AR. EXACT URL TO OPEN FIRST

Open **http://127.0.0.1:3108**. Start with City movement, E interaction and Forecast. Use Inspect → FORECASTS/CAMERAS/PERFORMANCE for provenance and actual GPU work. LIVE retains the Google/replay flow. Run npm run benchmark:forge to reproduce the local research path; fixture is the default and makes zero paid calls. The separate live evidence is frozen because the twenty-request cap is exhausted.
