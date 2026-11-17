# GPU field futures

GPU_UNAVAILABLE. This run measured CPU field simulation only. CPU/TypeScript maximum field error: 4.5549376481712756e-7. CUDA, GPU speedup and the live bridge are unverified for this machine. See gpu-futures.json for actual CPU batch timings and Monte Carlo outputs. No whole-City acceleration is claimed.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
