# Architecture

The City extension uses the same ForgeService, store, restricted executable worker, broker and registry. [City architecture](CITY.md) documents EnvironmentProvider, GoalContract, real generated city/v1 programs and 20 paired Futures. [Lab](LAB.md) adds voice challenges, isolated experiments, uncertainty, evidence signatures and owner checkpoints without a new agent system. Legacy domain-specific resolver behavior below remains applicable to Studio/World/Live; free-form City interpretation is provided by Bedrock.

The final expansion adds generated `deadline/v1` source, Reality Replay, scoped Google connector deployment, persisted single-process polling and signed Capsules to this same engine. [Progressive Trust](PROGRESSIVE_TRUST.md) describes the additional boundaries; [final report](FINAL_EXPANSION.md) distinguishes exercised services from unverified Google writes.

FORGE is a self-hosted MCP server connected through our independent Alexa+-style Agent Simulator. It safely grows the server's toolset through open MCP, without modifying Alexa's model or code.

## End-to-end path

`forge.build` accepts a goal. Capability retrieval combines exact normalization, token-overlap cosine similarity and deterministic modification filtering. Resolution is EXACT_MATCH, COMPOSE, EXTEND or SYNTHESIZE. The deterministic local compiler builds new constrained workflow configurations; a configurable Bedrock provider can propose supported DAGs. Composition copies compatible existing nodes, and reuse is recorded.

ForgeSpec contains the DAG, manifest, budgets, version lineage and derived MCP input/output schemas. Schema, DAG, dependency and exact-minimum-permission checks reject malformed output. A release runs 14 executable behavior/policy checks and 8 security checks. Failed reports block installation. Approval is bound to the capability's canonical SHA-256 digest and validated parent version.

Only approved installed releases enter `McpToolRegistry`. The real SDK exposes them as named tools. A tools/call handler routes to `ForgeService.trigger`; it cannot bypass approval, digest validation, the broker, sandbox or audit records. A separate DSL worker chooses topologically ready nodes and handles bounded retries. The trusted broker verifies the node/operation, dependencies, manifest, deadlines, thresholds and side effects independently. All effects use stable capability/event/node keys.

## Module boundaries

| Module          | Responsibility                                                         |
| --------------- | ---------------------------------------------------------------------- |
| spec/contracts  | Typed DSL, canonical MCP contracts, DAG and data dependency validation |
| compiler/models | Registry retrieval, constrained synthesis, optional Bedrock generation |
| records/store   | Validated releases, reports, executions, effects; atomic transactions  |
| service         | Stage, approve, trigger, extend, repair and rollback                   |
| mcp-registry    | Real named-tool registration; protocol-specific change adapter         |
| broker          | Trusted primitive operations, minimum access and idempotent writes     |
| sandbox/worker  | Isolated program interpretation and token-bound broker protocol        |
| validation      | Actual behavior cases and adversarial attacks                          |
| aws             | DynamoDB, EventBridge and CloudWatch interfaces/adapters               |
| app/components  | Simulator, review, real MCP discovery/calls and trace rendering        |

## Storage and reliability

Build progress is a bounded, process-local map of actual stage start/end observations. The UI passes a UUID to MCP forge.build and polls the guarded owner API; no synthetic timers predict completion. Completed compilation, permission-validation, test and security durations persist with the proposal. Rejection is durable. Duplicate approval validates the digest and returns the active release without duplicating audit/install state. Upgrade preserves lineage; rejected updates leave the previous installed version usable.

Execution events record request receipt, selected capability/version/digest, permissions and sandbox boundaries; primitive traces record actual broker operations, attempts, gates and denials. Payloads are excluded from lifecycle telemetry. Node traces and redacted outputs remain inspectable. No hidden model reasoning is displayed.

The local JSON store uses serialized copy/validate/write/rename transactions within one process. It is for one running server, not multi-process deployment. Approved releases persist across restarts and rebuild MCP handlers. Successful duplicate events return the previous execution. Concurrent same-process duplicates share a promise. Failed events can retry; effect keys survive version changes and prevent repeated notification/document writes.

DynamoDB uses optimistic revision checks for prototype snapshot transactions, with bounded conflict retries and a 350KB ceiling. Production should partition capability/release/execution/effect records and add durable distributed event leases. Distributed duplicate execution prevention is not claimed.

## FORGE World simulation

`/world` is a second client of the same MCP lifecycle; `/studio` and `/` preserve the existing simulator. Original SVG/CSS art projects validated persistent state rather than issuing device effects itself. `world.ts` defines five rooms, strict state, derived energy and 20 trusted primitives. `world-planner.ts` lowers supported fixture intents; the Bedrock system contract describes the same bounded operations. Compiler retrieval reuses compatible installed nodes, and EXTEND retains release lineage.

The broker validates approved node/configuration and exact permissions before world reads or transactional writes. Effect keys, process worker boundaries and canonical contracts are shared with the career/household domains. The owner API exposes audited scene inputs and a real undeclared-unlock attack probe. Execution traces and installed versions drive the visual proof drawer. A simulated clock enables reproducible conditional thermostat behavior; it is not a scheduler. See [WORLD.md](WORLD.md) for state, semantics and limits.

## Intentional scope

Generated source is restricted to one typed synchronous function with a JSON interface and isolated execution. Unrestricted native code/network, self-optimization, a production Fargate control plane and native Alexa integration remain outside scope. Existing controlled schema repair remains tested. Connector deployments can use a persisted local poller while the application is alive; distributed scheduling is not implemented.
