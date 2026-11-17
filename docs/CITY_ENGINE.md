# City engine

The trusted host owns a 2240 × 1600 City, player inputs, 48 road nodes, 560 physical terrain cells, traffic, pedestrians, building demand and grid topology. The browser predicts bounded movement using the same collision and acceleration equations; sequenced host inputs commit position. WASD/arrows move, Shift sprints, E inspects within 52 units, M changes camera, Tab opens technical inspection, Escape closes panels, Enter focuses chat. Typing clears movement. Generated code cannot teleport the player.

Flood water diffuses by relative elevation and drainage; wildfire spreads through fuel, wind and wetness; fire produces smoke; gas advects; earthquake damage, moving tornado damage, storm rain and reduced road capacity alter real City state. Grid failures propagate plant → substations → buildings and darken affected signals. A damaged hospital can lose backup generation. These are deterministic synthetic equations, not engineering-grade disaster models.

Generated actions use only existing typed road, signal, dispatch, shelter, population and power actuators. Roads, routes, critical power and shelter reservation limits remain host gates. See tests/city-physics.test.ts and artifacts/ml/gpu-input.json for physical execution evidence.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
