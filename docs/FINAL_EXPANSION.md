# FORGE final expansion

The expansion uses the existing engine. Replay, revocable connector authority, generated executable source and signed Capsules are implemented and exercised. **A real Google Calendar write remains unverified because Google OAuth is not configured.** The requested real-world-write stop condition is pending.

## 1. Implemented

Generated `deadline/v1` TypeScript artifacts inside ForgeSpec; strict compilation and isolated execution; actual admission reports; Google/fixture snapshot connectors; intercepted Reality Replay; Shadow; separate exact permission promotion; revocation/global pause; persisted polling; encrypted backend secrets; signed Capsule export/import with fresh trust. These reuse ForgeService, compiler, broker, sandbox, registry, owner approval and version history. World, Studio, voice and existing workflows remain.

## 2. Genuinely live

Bedrock generated Deadline Guardian through FORGE's actual compiler using SDK credentials from profile `forge`, region `ca-central-1`, inference profile `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Request `b99d53ec-ff24-4afb-b15c-dc4ba88d671f` returned HTTP 200 in 18,608ms at `2026-10-07T03:12:16.345Z`; 3,119 input / 1,729 output tokens. Schema/source validation, 22 admission checks, fixture replay and actual installed MCP invocation passed. Evidence: `artifacts/bedrock-live-proof.json`. Cost is unset rather than invented.

Four earlier separately recorded paid candidates failed source/admission checks despite HTTP 200. One assertion was corrected to accept multiple genuinely denied retries instead of exactly one. These failures remain recorded; this is not first-attempt model success. Local Ed25519 signing, worker execution and protocol/UI interactions are real computations. Prior career/World AWS evidence remains.

## 3. Simulated or unverified

Fixture history/compiler/effects, World devices and career/household effects are simulated. Google consent/API paths have injected contract tests; actual OAuth/writes are pending. KMS/S3 are implemented and contract-tested, without live service evidence. Native Alexa+ and hardware are unverified; no production security certification is claimed. City was deferred to prioritize replay and authority.

## 4. Google behavior

OAuth uses PKCE, one-time expiring state, HttpOnly cookies and incremental read/write consent. Tokens remain backend-only encrypted data. Gmail readonly and Calendar events readonly support replay; Calendar events consent enables writes. The configured dedicated Calendar and exact sender allowlist bound the connector. No Gmail send scope exists.

Reads are bounded to 250 messages from 30 days and 250 Calendar events; excess pagination fails. Plain-text explicit `Deadline changed/moved to YYYY-MM-DD` messages with matching subjects are supported. All-day deadlines/study placeholders can be created/updated; timed changes are denied. Creates use deterministic IDs, updates use ETags. Notifications are local persisted effects. Raw Google history stays transient; persisted evidence withholds titles/dates and hashes references. Reconnection invalidates grants. Disconnect drops local tokens; Google connected-app settings remove provider consent. [Full setup and privacy](GOOGLE.md).

## 5. Reality Replay

The same source, sandbox and broker process chronological snapshots. REPLAY/SHADOW intercept every write; the connector write method is never called. Later messages see earlier hypothetical state. Pause/speed/inspect play recorded events and create no new effects.

Eight labeled fixture emails and two initial events produce three confirmed changes, two updates, four creates including three study placeholders, and one notification: seven proposed effects, zero external writes. All eight independent labels match, precision/recall 1.0 on this small explicit-format bundle. Five negative cases include attack/unapproved sender, newsletter, invalid date, ambiguity and duplicate. Google histories have counts without accuracy. Evidence deletion revokes associated grants.

## 6. Progressive Trust

Trust is persisted per exact digest. GENERATED earns SANDBOXED/TESTED/SECURITY_VERIFIED evidence, then REPLAYED, owner HUMAN_APPROVED installation, and separately owner SHADOW or LIVE grants. World also earns SIMULATED evidence. Imports start UNTRUSTED.

Promotion rechecks replay on the current connector binding, installed approved release/version/digest and exact permissions. Google requires provider write consent. Grants are `gmail.read`, `calendar.read`, `calendar.write`, `notification.emit`; Shadow grants reads only. Revocation clears every version and disables polling. Pause blocks dispatch/per-write checks. Rollback revokes executable authority and changes software, without undoing external writes. Models cannot grant trust. [Detailed gates](PROGRESSIVE_TRUST.md).

## 7. Capsule file format

`.forgecap` is bounded `forgecap/v1` JSON: manifest, sanitized portable ForgeSpec, source/artifact hash, schemas, test manifest, count-only evidence, dependency interfaces, provenance and signature. No token, raw history, local grant or owner approval is exported. Existing DSL capabilities also package. [Formal schema and reusable package](../packages/forge-capability/README.md).

## 8. Signing and verification

Canonical JSON recursively sorts object keys, preserves arrays and uses SHA-256 over UTF-8 JSON. Actual local Ed25519 signs the 32 hash bytes. Optional KMS uses regional RSA_2048 SIGN_VERIFY / RSASSA_PSS_SHA_256 with offline public-key verification. Import validates bounds, hashes, signature, artifact/manifest/schema consistency, permissions and DAG before actual local tests. Tampering fails before execution.

A valid included public key establishes integrity relative to that key, not publisher trust. Imported software inherits zero approval, replay or permission. Source review is still needed; arbitrary embedded secrets cannot be universally detected. The vault does not protect against complete host compromise.

## 9. AWS exercised

Actual Bedrock Converse generated the executable capability. KMS/S3 use injected contract tests; existing DynamoDB/EventBridge/CloudWatch adapters have no new live deployment evidence. No new AWS resources were provisioned. [Services and configuration](AWS.md).

## 10. Routes

Added `/live`, `/capabilities`, `/api/live`, `/api/google/callback`. Existing root/Studio/World/Forge/MCP/health routes remain. Ten fixed forge.* MCP adapters wrap the same service; owner approval remains separate. Dynamic tools appear after approval.

## 11. Material files

Core extensions: `src/forge/{spec,compiler,models,service,records,broker,sandbox,mcp,mcp-registry}.ts`. New engine modules: `live-contracts.ts`, `live-planner.ts`, `live-broker.ts`, `replay.ts`, `replay-fixtures.ts`, `executable.ts`, `connectors.ts`, `vault.ts`, `capsule.ts`, `aws-artifacts.ts`. Runtime: module worker, Dockerfiles, Next trace config, instrumentation poller. UI: ForgeLive, Live CSS/routes, Studio/World navigation/shared voice. Schemas: `packages/forge-capability/` and expanded `packages/forgespec/`. Verification: Bedrock verifier, trust evaluator, Docker module proof, six new test files and Live browser flow. Configuration: lockfile/runtime TypeScript, Google Compose overlay and environment example. Documentation: this report plus linked setup, trust, format, verification, demo and friction pages.

## 12. Results

64 unit/integration tests and 15 Chromium flows pass. The retained frozen suite is 49/49 expected scenarios; a separate trust evaluation passes 12/12 category checks. Categories overlap; these are not general accuracy claims. Final strict typecheck, lint, formatting, Windows/Linux builds, packaged HTTP lifecycle and both Docker worker proofs are recorded in [VERIFICATION.md](VERIFICATION.md). Browser voice checks simulate recognition; physical microphone/speech service requires rehearsal. Injected service tests never count as live evidence.

## 13. Local judge instructions

Run `docker compose up --build -d --wait`; open `http://127.0.0.1:3108/live`. Keep FIXTURE selected. Build → inspect checks/zero grants → Replay → pause/inspect → approve tested capability → inspect actual T0/T1 lists → Shadow run → exact fixture grants → invoke → revoke. Export .forgecap, reject its tampered copy and import original with valid signature but zero grants. Replay/reapprove imports locally. Gallery shows retained releases.

Use Studio for internship generation/attack/version/rollback and World for simulated household effects. For a pristine take, use a separate Compose project/port; preserve main user data. Automated approval harnesses always use isolated state.

## 14. Google Live instructions

[GOOGLE.md](GOOGLE.md) covers enabled APIs, consent test user, Web OAuth client/exact callback, dedicated Calendar, five private environment variables and production Compose overlay. Connect reads, authorize writes, replay on the final binding, approve release/exact grants, run and externally confirm the returned Google Calendar event/date. Record receipt and observed date before claiming a real write. Revoke afterward.

## 15. AWS verification instructions

Default submission stays `FORGE_RUNTIME_MODE=fixture`. The paid compiler proof:

```powershell
$env:AWS_PROFILE = 'forge'
$env:AWS_REGION = 'ca-central-1'
$env:BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
$env:FORGE_RUNTIME_MODE = 'aws'
$env:FORGE_VERIFY_DOMAIN = 'live'
npm run verify:bedrock
$env:FORGE_RUNTIME_MODE = 'fixture'
```

The verifier makes one real Converse request through the actual compiler, validates output, checks/replays it, installs in isolated state and invokes its MCP tool. Credentials resolve normally and are never printed. Errors fail visibly without fixture fallback; model-access/Anthropic first-time-use errors require their console action. Existing successful proof need not be rerun for fixture rehearsals.

## 16. Limits

Google write proof is pending. Parsing is explicit/bounded. Persistent polling requires a running single app process; it is not distributed scheduling. Live Google uses local serialized storage, not DynamoDB callback dispatch. External writes may partially commit; uncertain delivery needs reconciliation. IDs/ETags/receipts/processed markers limit duplicates without an exactly-once guarantee. Sender allowlists do not authenticate mail headers. Timed events, arbitrary connectors, remote registries, optimization and City are outside scope. Public deployment needs fuller owner authentication and security review.

## 17. Final demo

[175-second script](DEMO.md): generation/replay → actual MCP discovery → grants/invocation/revoke → signed export/tamper/import → short attack/version cut → brief World generality. Google branch requires successful external evidence first.
