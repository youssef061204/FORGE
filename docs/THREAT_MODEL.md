# Threat model

| Threat                                | Boundary / mitigation                                                                        | Evidence / limitation                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Retrieved prompt injection            | Content remains data; no instruction-driven tool selection; undeclared external write denied | Real hostile-fixture run + actual broker denial      |
| Model permission escalation           | Exact derived manifest and enum allowlist                                                    | Executable schema and broker checks                  |
| Tool invocation before approval       | Agent has no install tool; registry only exposes approved releases                           | T0/T1 MCP integration and early-call failure         |
| Modified validated program            | Canonical digest bound to report/approval; revalidated before execution                      | Tamper test                                          |
| Cycles / runaway workflow             | DAG cycle validation and node/attempt/call/runtime caps                                      | Validation tests                                     |
| Host commands / secret reads          | No primitive; worker Node permission policy; credentials stay outside                        | Static rejection; no claim of arbitrary-code support |
| Duplicate notification / document     | Stable capability/event/node effect keys; local transaction                                  | Actual replay checks and concurrent-event test       |
| Cross-capability access               | Broker bound to exact capability and declared node                                           | Real foreign-node denial                             |
| Browser-origin attack / DNS rebinding | Host and Origin checked, loopback-only anonymous access                                      | Boundary tests and browser verification              |
| Multi-process races                   | DynamoDB revision conflicts; local single-process deployment                                 | Durable distributed leases still needed              |
| Compromised owner/server              | Trusted store/broker can be modified by owner-level access                                   | Outside this prototype's trust boundary              |
| Worker CPU abuse                      | Docker CPU/PID/memory/network policy; process wall time/heap bounds                          | Process mode lacks OS CPU/PID quotas                 |
| Calendar/email side effects           | Scoped OAuth, owner grants, broker and intercepted replay                                    | Injected tests; actual Google write pending          |

Security claims apply to the constrained DSL, bounded executable interface and supported primitives. See [Progressive Trust](PROGRESSIVE_TRUST.md) for source isolation, Capsule trust reset and revocation. They do not establish resistance to arbitrary native code, model jailbreaking in a general agent, or a compromised trusted backend.
