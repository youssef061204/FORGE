# Free-only execution

The current user instruction forbids paid features. Normal launches and the
submission set `FORGE_FREE_ONLY=true`; absence of the setting also blocks paid
operations. Existing AWS credentials, service credits, and advertised free tiers
do not change this decision. No paid request is needed to build, test, inspect,
or run the local submission.

`src/forge/cost-policy.ts` is the shared enforcement boundary. It rejects cloud
adapter construction and rechecks policy before SDK requests. It covers both
legacy capability and Twin compilation, the product software compiler, DynamoDB
state, EventBridge events, CloudWatch audit export, KMS signing, and S3 storage.
The product compiler also blocks credential-provider creation and status lookup.
The existing scheduler is a local process timer, not a cloud scheduler.

Configuration rejects cloud-backed runtime settings while free-only policy is
enabled. This fails visibly instead of silently treating a requested AWS run as
a successful fixture run. The supported zero-cost paths remain local state,
local signing, local simulation, isolated workers, installed software, and
explicitly labeled test/recorded model responses. A locally installed model may
run on the user's hardware; it must never fall back to a hosted model.

`verify:bedrock`, `verify:city:aws`, and the synthesis benchmark's `--live` path
reject execution before credential lookup or artifact writes. Historical live
AWS results remain historical evidence; refusing a new run does not replace
those files with a failed proof or imply that a fresh live proof succeeded.
The historical 20-request ledger is preserved and conveys no current spending
authorization.

Dormant cloud adapters are retained for reproducibility and possible future use.
An explicit `FORGE_FREE_ONLY=false` can be used by isolated tests with injected
SDK responses, and by a future separately authorized deployment. It is not a
permission to spend under the current instruction. There is no product control
that disables the policy. Malformed values fail closed.

Imported third-party APIs can have their own billing policies. A successful
connection or an endpoint described as public does not prove zero cost. The
shared `secureFetch` transport therefore blocks external OpenAPI and MCP network
requests before URL parsing, DNS, or HTTP while free-only policy is enabled.
Parsing imported schemas remains local. Injected HTTP responses and linked
in-memory MCP transports continue to support isolated contract tests. Existing
Google OAuth adapters are preserved; this work does not invoke or reconnect them.

Focused verification:

```powershell
npx vitest run tests/cost-policy.test.ts tests/bedrock.test.ts tests/aws-artifacts.test.ts tests/boundaries.test.ts
```

These tests use injected SDK responses. They check default denial, each paid
configuration path, denial before credential-provider creation, rechecking
existing instances, zero SDK dispatch, and paid proof refusal with unchanged
historical evidence hashes. They do not call AWS.
