# Sensor fusion

Separate trained logistic heads combine four calibrated camera probabilities, four structured physical sensor measurements and explicit camera/sensor quality flags. Whole episodes define the splits. Training includes clean, obscured, missing, spoofed and delayed measurements; combined obscuration/spoofing is an unseen corruption mode. Obscured predictions genuinely rerun the CNN on obscured pixels. Delayed sensor values come from earlier frames in the same episode/location.

Compare camera-only, structured-only and fused Brier/F1 by corruption family in sensor-fusion.json. Known test flags are controlled input metadata, not an omniscient detector of arbitrary attackers. Runtime CAMERAS offers explicit obscured/missing/spoof tests. Weather/history/learned arbitrary fault detection are not claimed beyond their actual structured simulation inputs.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
