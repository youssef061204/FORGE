# World model

The frozen dataset contains 640 whole episodes: 384 train, 80 validation, 80 held-out, 48 shift and 48 compositional. It records 86,400 City transitions and 276,480 node/horizon examples. Observation origins precede every target. Forecasts predict queue, delay, congestion, water, fire, smoke, power, hospital demand and emergency demand at +30/+60/+120 seconds using 121 current, lagged, road-neighbor and grid-parent features. IDs and future state are excluded.

Measured competitors are persistence, moving average, Ridge, nine boosted heads, a shared temporal MLP, a shared graph feature MLP and independent neural heads. Validation MAE selects each output head; validation alone calibrates risk and residual intervals. Selected held-out queue MAE is 0.5836, delay MAE 4.156 seconds. Every head, horizon, episode-bootstrap CI and shifted failure remains in world-model.json and shift.json.

Forecast overlays and asset panels label all projections FORECAST. Low support or missing history requires actual full Futures. No accuracy metric grants permission. Portable Python/TypeScript parity uses 24 frozen held-out examples. Node-level hazard IoU/F1 is not full-area segmentation accuracy.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
