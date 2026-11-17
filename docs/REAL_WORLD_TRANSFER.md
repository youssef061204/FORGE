# Real geometry and external evaluation

A cached read-only OpenStreetMap extract from central Kingston contains real nodes and highway ways. FORGE retains a connected 64-node BFS subset with actual intermediate bend coordinates and omits remaining streets to fit host topology bounds. Screen coordinates are normalized, not calibrated physical meters. Attribute © OpenStreetMap contributors under ODbL; source URL, bounds and raw-data hash are recorded. API/copyright sources: https://wiki.openstreetmap.org/wiki/API_v0.6 and https://www.openstreetmap.org/copyright.

Only road geometry is real. Buildings, traffic, signals, hazards, weather and grid are synthetic; no current traffic observation or real disaster prediction is claimed. Owner map changes save a checkpoint/backup, revoke current City authority, and return to the prior Northbank snapshot without resurrecting deployment grants.

The external evaluation downloads 10,320 actual NYC taxi demand observations from the Numenta Anomaly Benchmark and chronologically separates train/validation/held-out samples. Persistence, daily seasonal and rolling-mean forecasts are measured on counts. Northbank neural forecasts have incompatible features and units, so their transfer is explicitly unverified. Dataset source: https://github.com/numenta/NAB. Repository licensing is AGPL-3.0; the cached input is research data, not embedded in the app.

Domain randomization evaluates equal 192-episode nominal versus randomized training groups on the same held-out/shift/compositional queue forecasts. It reports results even when randomization loses. This is synthetic robustness evidence separate from external validity.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
