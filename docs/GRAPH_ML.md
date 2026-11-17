# Graph learning

A one-hop mean aggregator derives local road-neighbor and physical grid-parent observations. A trained nonlinear shared MLP consumes current/lagged and aggregated graph features. This is a GraphSAGE-style feature and neural baseline; no recurrent message-passing stack or unseen-topology learning claim is made. Graph, temporal and independent heads are compared on exactly the same episode-separated observations. The validation-selected deployed model may choose a different baseline for each target.

artifacts/ml/graph-model.json contains measured per-head errors. OSM topology changes remain outside training support and require conservative simulation; imported geography does not establish graph transfer.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
