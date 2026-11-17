# Revised scope: self-extending MCP server

## Current-state inspection (2026-10-06)

At the update: 22 Vitest tests passed; one TypeScript assertion still required correction. ForgeSpec, compiler, permission broker, process worker, transactional local store, validation reports, approval/installation, versioning, controlled repair, and rollback were implemented. AWS adapters and a stateless SDK MCP endpoint existed but had not been verified live. Docker image built. UI was not implemented. No Git metadata exists.

## Keep / adapt / defer / remove

| Component                             | Decision | Rationale                                                            |
| ------------------------------------- | -------- | -------------------------------------------------------------------- |
| ForgeSpec, validator, broker, storage | KEEP     | Real security/runtime foundations                                    |
| Compiler and registry                 | ADAPT    | Compile and persist named input/output MCP contracts                 |
| MCP endpoint                          | ADAPT    | Expose each approved installed release as its own tool               |
| Red team                              | ADAPT    | Attempt unauthorized external transmission against the actual broker |
| Telemetry / versioning / rollback     | KEEP     | Support review and traceability                                      |
| AWS adapters                          | KEEP     | Optional real implementations; cloud verification outstanding        |
| Repair                                | DEFER    | Existing tested code retained; outside primary demo                  |
| Optimization / distributed execution  | DEFER    | Not needed to prove dynamic tool creation                            |
| Removal                               | NONE     | No functioning subsystem needs deletion                              |

## P0 blockers and chosen delta

Generate MCP contracts in ForgeSpec. Introduce a tool registry and SDK-specific change adapter. Build the SDK server from the persisted approved registry on each stateless HTTP request. Explicitly re-query tools/list after human installation; do not claim a persistent Alexa connection or unsolicited notification with this transport. Invoke the new tool by name through tools/call. Cover T0 absence, compilation, approval, T1 presence, invocation, version update and trace with actual MCP SDK integration tests. UI shows the actual tools/list response, actual validation evidence, human approval and actual tools/call result.

Framing: FORGE grows its own MCP toolset. It does not alter Alexa's model or internal implementation. The deterministic planner is a constrained local compiler, not an LLM; demo claims should describe workflow/tool-contract generation accurately.
