# FORGE implementation plan

This is the original foundation plan. The revised MCP-first scope is recorded in [ARCHITECTURAL_DELTA.md](ARCHITECTURAL_DELTA.md); the final architecture and measured checks are in [ARCHITECTURE.md](ARCHITECTURE.md) and [VERIFICATION.md](VERIFICATION.md).

## Repository assessment

2026-10-06: The supplied workspace is empty, including hidden files. There is no package manifest, source, configuration, test suite, or Git repository to reuse. Node 24 and Docker Engine 29 are available. No AWS access has been verified.

## Architecture and first proof

One Next.js / strict TypeScript app. ForgeSpec is an independent typed, validated workflow DSL. The compiler produces new DAGs from trusted primitives, never executable strings. A trusted broker owns permissions and effects. A separate worker interprets the generated program with brokered tool messages. Installation requires successful executable validation and human approval bound to a definition digest. Events execute only approved versions. The local registry persists versions, approvals, traces, and effect idempotency keys atomically.

First proof: natural-language internship monitoring request → structured IR → derived permissions → DAG validation → generated validation plan and executable checks → approval → installation → fixture event → ranked opportunity, persisted notification, and actual trace.

## Structure

`src/forge/spec.ts`: IR and DAG validation; `compiler.ts`: planning and resolution; `models.ts`: demo and Bedrock; `broker.ts`: policy and trusted tools; `sandbox.ts` + `sandbox/worker.mjs`: execution boundary; `validation.ts`: executable checks; `store.ts`: persistence; `service.ts`: lifecycle; `aws.ts`: cloud infrastructure adapters; `src/app`: simulator and APIs; `tests`, `e2e`, `evaluation`, `infra`, `docs`.

## Records and critical interfaces

Capability: identity, version, parent, intent, trigger, nodes/edges, limits, manifest, generated artifacts, semantic patch. Release: immutable definition, digest, test/security reports, status, approval/deployment timestamps. Execution: event key, version, status, timings, trace, tool calls, denials, outcome. Effect: stable event/node key and persisted output. ModelProvider: structured generation plus measured usage. StateStore: transaction. Sandbox: run bounded program through broker. EventBus and AuditSink: local and AWS adapters.

## Phases

1. Schemas, acyclic graph validation, persistence and tests.
2. Structured compiler, capability retrieval, minimum permissions, artifact generation.
3. Worker, broker, retry/timeout limits, telemetry and idempotent effects.
4. Executable generated checks, red team, approval and lifecycle.
5. Alexa simulator, graph, review, traces and observability.
6. Natural-language extension, deterministic schema failure/repair, version rollback.
7. Bedrock, DynamoDB, EventBridge, CloudWatch, MCP and infrastructure path.
8. Frozen evaluation, browser lifecycle verification, documentation and demo assets.

## Risks and assumptions

The local deterministic planner supports a documented request grammar; it is not represented as an LLM. Bedrock can propose arbitrary supported DAGs, which must pass identical validation. Fixtures simulate external data only. The process sandbox restricts Node permissions, secrets, heap and wall time but lacks OS CPU/process quotas; Docker is the hardened local path. Arbitrary generated host code is forbidden. Public hosting requires authentication and durable infrastructure. External email/application/purchase actions are unavailable. AWS adapters can be tested locally with injected clients; no cloud deployment is claimed without live verification. Optimization is a future approval-bound release pipeline, not a silent production rewrite.
