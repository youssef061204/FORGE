# Product overhaul worklog

Request: attachment 559909f1-c313-42a5-9f54-a3614e339102, the 44-part product/architecture overhaul.

Baseline frozen before relevant subsystem changes: `artifacts/product-overhaul-baseline-2026-10-10/manifest.json` (240 files, 48,754,008 bytes). No credentials/private connector state included. Earlier benchmarks are baseline evidence until rerun.

Current phase: connector fabric and generic bounded executable program contract. Preserve legacy compiler/research fixtures as explicit test/Inspect facilities; normal Home requests use the new resource-driven compiler through the same persisted service and MCP transport.

External constraints confirmed by the user: **no additional paid Bedrock requests**; Spotify is excluded. The main instance reported Google disconnected despite the user's earlier expectation. The user subsequently declined reconnection ("accc no i wont"); do not ask again, reconnect, or make Google writes. The previous 20 paid requests are exhausted and `forge` AWS session has expired. Preserve earlier live evidence as historical baseline; new live synthesis and Google effects are unverified.

Required work:

- [x] Read complete request; freeze baseline.
- [ ] Connector registry, runtime metadata and schema/permission broker.
- [ ] Built-in Google/local notifications/Twin, missing media connection, OpenAPI import, external MCP. Spotify excluded by latest user direction.
- [ ] Generic Bedrock source synthesis, tests, sandbox and authorized replay.
- [ ] Retrieval, reuse, composition, contextual extension and versions.
- [ ] Persistent local triggers, pause/revoke, receipts, recovery and uncertain-write handling.
- [ ] Home / Tools / Activity / Inspect shell; Twin secondary, remove player controls.
- [ ] Hero workflows, connection-specific explanations, result-first UI.
- [ ] Frozen mission/retrieval/permission/connector/trigger/replay/failure/recovery benchmarks.
- [ ] Controlled Google proof where existing scope permits; distinguish live/test/simulation results. No additional Bedrock requests.
- [ ] Rerun existing ML/CUDA/safety benchmarks and report baseline/current.
- [ ] Full tests, browser stories, typecheck, lint, builds, main state preservation and deployment.
- [ ] A–AP report, current resume evidence and three-minute demo script.

Keep updating this log with concrete files, commands, pending sessions and measured outcomes across continuations. Do not call the overhaul complete until the acceptance story is verified or explicitly identify external prerequisites that prevent live acceptance.

## October 10 local implementation and verification

- New `src/forge/product/` connector fabric, schema broker, pinned public HTTPS transport, bounded OpenAPI JSON/YAML import and external MCP client.
- Generic Bedrock source compiler uses forge / ca-central-1 / the user-configured Sonnet inference profile. Normal fixture Home stays OFFLINE; explicit recorded test injection is development-only and never substitutes for a failed live call.
- Persistent versions, hybrid local retrieval, reuse, contextual extension, hashed composition contributors, exact binding approval, read-only replay, durable execution plans/outbox and uncertain-write containment.
- Owner-authenticated local connector event relay, polling/schedule monitors, pending-event recovery, pause/revoke and receipt-first Activity. Local backend is labeled; no provider webhook subscription claimed.
- Home / Tools / Activity / Inspect, voice hook, Twin secondary with pan/zoom/select and no rendered avatar or WASD controls. Existing simulation/research and installed legacy capabilities preserved.
- 142 unit tests / 20 files passed; typecheck passed. Product MCP browser lifecycle passed (recorded source + controlled test connector, not Bedrock/Google).
- 100 controlled execution cases passed, 140 expected test writes, 0 unexpected writes; 100 replay comparisons passed with 0 external writes. 100 synthetic retrieval queries: Recall@1 .92, Recall@3 1, MRR .95667. These are not 100 NL synthesis missions.
- Additional 50 event deliveries + 50 duplicates, 50 permission derivations, 1 pending-event recovery and four fault categories passed in `artifacts/product/reliability-benchmark.json`.
- Actual public httpbin OpenAPI read validated. Petstore schema mismatch / HTTP 500 retained as failed public evidence.
- Full 31-stage ML suite running in session 66969; current CUDA unavailable in this execution environment, CPU batch scaling completed to 2048. Local CUDA bridge also unavailable; retain historical RTX evidence only as baseline.
- Legacy 20-test browser suite running in session 84108. Next sources frozen while browser checks run. Lint identified helper require imports/navigation warning; corrected, rerun pending.
- Still pending: full suite completion, Linux production build/deployment preserving state, docs/A–AP/demo and final evidence. New live source synthesis / live Google / native Alexa+ remain explicitly unverified under user constraints.
