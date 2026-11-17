# FORGE City

City is an authoritative software-controlled DIGITAL TWIN, not physical infrastructure. The root route and /city open an authored Canvas pixel city. The old apartment remains at /world, technical interface at /studio, Google/replay workflow at /live and capsule gallery at /capabilities. The persistent shell shares server access and conversation across these routes. /lab adds the [ten voice and evidence features](LAB.md).

## Architecture

One ForgeService owns the registry, release store, sandbox, broker, trust and versions. CityFoundry orchestrates goals and Futures; it is not a second assistant or capability registry. CityLab runs owner-facing evidence experiments on the same worker and broker. The EnvironmentProvider interface exposes observe, query, subscribe, execute, resources, capabilities and constraints. TwinEnvironmentProvider reads and atomically changes the same persisted City. GoogleEnvironmentProvider wraps the existing Google connector and per-write broker; only installed deadline/v1 capabilities are available there.

GoalContract is strict Zod data: a goal, measurable hard constraints, weighted objectives, supported actuators, forbidden outcomes, priorities and interpretation. Unsupported actions fail schema validation. A capability's declared City actions must exactly match the contract and its derived permissions. No generated module acquires authority from prose.

Owner request -> resource/constraint/software discovery -> Bedrock interpretation and three actual TypeScript programs -> strict schema and source checks -> actual isolated-worker preflight -> bounded repair if needed -> 20 paired stochastic Futures per viable candidate and baseline -> reject sampled unsafe candidates -> rank eligible candidates by p95 objective loss, then mean -> existing release validation -> exact digest approval -> bind to and execute against the current authoritative City -> installed MCP discovery and invocation.

Repair can replace source, but cannot weaken the original accepted measurable contract. Fixture mode uses an explicit development model double with a fixed contract and three different programs. Fixture mode does not provide general natural-language understanding. AWS mode uses the real Bedrock compiler, never an intent keyword handler or silent fixture fallback.

## Simulation and visible effects

The model contains 48 signal nodes, 82 road segments, three river crossings, 30 buildings, 52 civilian traffic vehicles plus three responders, and 64 pedestrians. Vehicles follow real graph paths; signals, queues and road congestion affect movement. Responders remain parked until dispatched. Pedestrians move on routes and evacuate to capacity-limited shelters. Metrics derive from actual state, including incident response ages. Critical infrastructure, weather, road risk and building damage evolve in simulation ticks. Day/night lighting and rain are rendered from that state.

Hazards: flood, wildfire, earthquake, tornado, blackout, storm, gas and traffic. Owner world controls create incidents, toggle roads, damage buildings, change weather, add traffic and pause. Structural changes flag deployed assumptions as degraded. Adaptation is an explicit owner request, not automatic paid self-optimization.

WASD/arrows move, Shift sprints, E inspects a nearby building, M switches map view, Tab from canvas opens the inspector, Escape pauses. Buildings, water and map boundaries constrain movement. Typing and focused interactive controls do not move the player.

The visible City effects originate in the actual three-node workflow: city.observe -> executable.run -> city.apply. The isolated TypeScript module produces validated typed proposals; the broker atomically validates and commits them. Execution traces record real worker and broker outcomes. The UI does not substitute animation for successful execution.

## Futures and safety

Each rollout clones one observed snapshot into a private MemoryStateStore. Twenty cryptographically drawn uint32 seeds are paired across policies and baseline. Weather and incident draws use a separate exogenous stream; generated policy runs at 0, 40 and 80 simulated seconds, with 4-second ticks across a 120-second horizon. Forks never dispatch external writes.

Different source hashes alone are insufficient: normalized TypeScript syntax-tree shapes must differ after replacing variable names and literal values. This catches renamed/retuned duplicates. It is a structural diversity test, not a proof of algorithmic independence.

Any sampled hard-constraint violation, worker failure or broker denial excludes a candidate. Lower weighted normalized loss is better. Report mean, median, p95, worst, sampled failure rate and violation counts separately. The p95 from 20 samples is a coarse order statistic. Zero observed failures is not a universal guarantee; the Lab exposes statistical uncertainty.

Independent host gates prohibit critical power below 90%, closing critical buildings, reopening unsafe roads, unsafe or disconnected routes, invalid resources, nonresponder dispatch and shelter overcapacity. Source cannot import, access host credentials/filesystem/network, use arbitrary globals or bypass the action schema. Output, syntax, VM runtime and worker wall time are bounded. Both process and Docker worker paths are exercised; Docker additionally disables networking, uses a read-only filesystem and does not inherit credentials.

Approval is tied to the exact tested release and Futures evidence. It grants only declared permissions on the current environment binding. It never restores the initial snapshot or promotes a private branch. The policy observes the current City when invoked; current safety gates can still deny actions after approval.

## Versions, portability and limits

Explicit extension includes the installed source in the baseline and candidate comparison. A staged successor allocates a version above all historical minor versions and requires new tests, Futures and approval. Rollback/revocation remove City authority; they do not rewind the world. Imported signed City software remains UNTRUSTED with zero grants, requires fresh local Futures and owner approval, and never inherits its publisher's environment or approvals.

One active City policy, bounded 120-second Futures, sampled simulator scenarios, one server instance and local persisted state are prototype limits. In-process jobs are not durable across restart. The City has no real traffic, power-grid or emergency-services connection. Current Google OAuth configuration is preserved, but no authenticated Google write is claimed without an actual connector receipt. Native Alexa+ preview deployment is not verified.

See [verification](VERIFICATION.md), [concrete final report](CITY_FINAL_REPORT.md), [recording plan](DEMO.md) and [Lab](LAB.md).
