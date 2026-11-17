# Final engineering pass

Request: 2026-10-07. Preserve the existing engine, routes, Google connector, MCP, worker/broker, approvals, versions, capsules, checkpoints and Lab. No new product pages or disconnected features.

1. Audit and preserve baseline evidence and running state.
2. Upgrade authoritative player/input/collision and disaster terrain, grid and demand state; optimize simulation hot paths.
3. Generate versioned episode-level train/validation/test/shift/compositional datasets from the actual engine.
4. Benchmark persistence, moving average, linear/logistic, boosting, temporal neural and graph aggregation models. Compare shared and independent heads. Select only on validation episodes.
5. Train outcome/risk, telemetry/OOD and policy behavior components. Calibrate on validation only; retain failures and episode-bootstrap intervals.
6. Export portable learned models for local TypeScript inference; integrate labeled 30/60/120-second forecasts and conservative adaptive Futures. Prediction never grants access.
7. Simplify existing UI and copy; improve player sprites, camera, district artwork, disaster animation, interaction and recorded branches.
8. Measure held-out accuracy, shift, calibrated risk, policy outcomes, adaptive versus exhaustive decisions, actual wall-clock cost and actual rendering performance.
9. Run retained and new tests, both production builds, HTTP/MCP/sandbox/Google/Bedrock checks. Preserve main data and Google overlay.
10. Publish reproducible benchmark artifacts, model cards, engineering/design docs and A–Z final report. Provide the exact URL and manual acceptance procedure.

Expanded request: 2026-10-07, attachment dd73dd7c. Continue the current work; add bounded RL/optimization/responders, rendered-camera perception/fusion, measured GPU/Monte Carlo, safety/repair/meta-controller, lifecycle, real geometry/external evaluation and profiling. Keep the same routes and owner/broker boundary. Report A–AR rather than the earlier A–Z.

Hardware audit: NVIDIA GeForce RTX 5050 Laptop GPU, 8,151 MiB, driver 595.95. CUDA/PyTorch execution has not been tested yet. No installed torch, ONNX Runtime or Z3 in the Python 3.11 interpreter at audit.

Paid provider budget: the user authorized up to 20 additional live Bedrock requests for this expanded pass. Record every actual request and stop paid work at that cap; local benchmark cases must be labeled separately.

Current status (2026-10-08):

- The complete 31-stage local benchmark finished with exit code zero; placement was corrected and rerun on its same 24 paired scenes, with all 96 worker/broker executions passing.
- Actual CUDA/PyTorch, trained forecasts/DQN/camera/fusion, optimization, Z3, public geometry/data, calibrated risk and whole-episode evaluation are recorded in artifacts/ml.
- All 20 authorized paid requests were executed: 12 synthesis, six repairs, one complete City compiler/MCP proof and one capability compiler/MCP proof. Further paid calls are disabled by the ledger cap.
- Unit/integration tests pass 106/106 across 18 files. The final browser run passes 19/19; the requested A?AR report and verification evidence are complete.
- Both Windows and Linux production builds pass. Authenticated production HTTP, Live and research/GPU/map/shadow/rollback checks pass.
- The verified main image is healthy at http://127.0.0.1:3108. All three installed release digests, World hash and Google configuration match the preserved baseline; fixture remains default.
- A final store performance correction caches validated snapshots by file identity/timestamps, returns isolated copies, validates external changes and every commit, and writes compact JSON. Its read benchmark and archived failures are retained.
- Features are frozen. Final regression evidence and the requested A?AR report are complete. Native Alexa+, authenticated Google writes and physical speech hardware remain unverified.

Additional execution order:

11. Create pinned Python research environment; test actual CUDA support and record exact unavailable paths.
12. Train bounded signal DQN; implement exact resource assignment/MILP and learned-priority refinement; benchmark centralized/decentralized responders on paired episodes.
13. Render camera frames, train perception heads using pixels only, benchmark corrupted/occluded sensor fusion.
14. Profile and vectorize physical field evolution, compare CPU/GPU correctness and throughput, scale Monte Carlo conservatively.
15. Integrate actual Z3 bounded broker invariants, saved adversarial fuzz/search cases, causal/counterfactual evidence.
16. Add model registry/shadow/rollback, evidence retrieval, bounded repair/routing/meta-controller and frozen synthesis benchmarks.
17. Import cached licensed OSM geometry, evaluate a public external dataset, test domain randomization.
18. Export/benchmark ONNX where supported; only build a custom GPU kernel if measured profiling warrants it.
19. Run benchmark:forge, regression checks, renderer/browser acceptance, production builds and deployment preserving the Google overlay.
20. Publish all requested research docs, resume evidence, measured A–AR report and unverified-path inventory.
