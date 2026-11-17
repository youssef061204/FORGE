# Virtual-camera perception

The actual City renderer produced 1,440 RGB frames from 160 whole episodes and three camera locations. A two-layer stride-2 CNN (3 → 8 → 12 channels, global mean pooling, four heads) trained on CUDA. The network receives resized image pixels only. Simulator labels are stored separately as supervision and never substituted for network output. Calibration uses validation episodes.

On 20 held-out episodes / 180 frames, flood F1 is 0.903. The congestion head failed: F1 0 with only 2 positive frames. Fire has sparse positives; inspect counts rather than quoting perfect accuracy. No real-camera validity, object localization or mAP claim is made. Actual portable convolution inference agrees with Python on four fixed pixel tensors; browser/Pillow resize implementations differ and browser inference is separately observed.

INSPECT → CAMERAS displays a live virtual feed, measured inference duration, pixel-only probabilities and fused estimates. Controlled obscuration is visible in the pixels.


Reproduce with npm run benchmark:forge. Fixture mode remains the default. Install pinned Python dependencies in .venv-ml and either the pinned PyTorch CPU or CUDA build described in ML_BENCHMARK.md. Paid calls are an explicit separate command; never a fixture fallback. artifacts/ml/evidence-index.json binds exported JSON artifacts to their SHA-256 hashes. Whole episodes are the unit of splitting and inference evaluation. Git metadata is unavailable in this workspace.
