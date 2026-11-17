# MCP protocol evidence

The current server retains the original tools and adds forge.goal, forge.environment, forge.futures plus four [Lab](LAB.md) tools: forge.mission, forge.rehearse, forge.evidence and forge.briefing. Installed policy tools are discovered by actual tools/list after owner approval. The simulator polls/rediscoveries truthfully; listChanged=false remains stateless. Native Alexa+ tool refresh is deployment-bound and is not claimed. Current packaged authenticated proof is artifacts/city-lab-http-proof.json; old proof artifacts remain preserved.

Installed/locked `@modelcontextprotocol/sdk`: **1.32.1**. Negotiated protocol: **2025-11-25**. Transport: **Streamable HTTP**, JSON responses. Endpoint: `http://127.0.0.1:3108/api/mcp`, following the launch port. Reference: [2025-11-25 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Automated evidence

`tests/mcp-http.test.ts` exercises the actual SDK server/transport wrapper: initialization, known/unknown version negotiation, capabilities, string/numeric request IDs, schemas, unknown methods, invalid tool calls, empty 202 notifications, media negotiation, unsupported protocol headers, malformed JSON and invalid messages. Legacy JSON-RPC batches are rejected with -32600; malformed JSON returns -32700; unknown methods return -32601 with the original ID. Invalid tool inputs produce `isError=true`.

`e2e/approval.spec.ts` tests the real Next HTTP route: 2025-11-25 negotiation, stateless headers, GET/DELETE 405, hostile Origin 403 and batch rejection. Existing browser/SDK lifecycle tests cover real list/call, upgrade and rollback. `npm run verify:http` repeats that lifecycle against a packaged server with explicit versioned wire requests and writes `artifacts/http-proof.json`. The artifact begins as incomplete and becomes passing only after all checks finish.

Stateless handling uses no session ID or persistent SSE connection. POST requires JSON and Accept containing JSON plus SSE. Notifications return empty 202; GET returns 405. Each request rebuilds approved handlers from durable state. `tools.listChanged=false` accurately declares explicit rediscovery. The simulator displays the revision read from its actual connected transport.

## Lifecycle

Fixed tools: `forge.build`, `forge.inspect`, `forge.create`, `forge.list`, `forge.preview`, `forge.approve`, `forge.execute`, `forge.rollback`, `forge.export`, `forge.import`. Build/create propose but never install. Optional UUID `buildId` allows the guarded owner API to return a bounded history of actual stage observations. `forge.approve` returns an owner-review request and admission report; it cannot approve installation or grant permissions. Approval/rejection/promotion remain owner API decisions. Dynamic capability tools appear only after approval and execute through the same registry and broker.

Deadline Guardian's dynamic invocation checks current connector binding and deployment grants. Preview uses Reality Replay with intercepted writes. Capsule export/import use actual signature verification and fresh local trust. The browser's T0/T1 inspector reads genuine MCP tool lists; fixed adapters are not evidence that a generated capability already existed.

Only verified approved installed releases enter `McpToolRegistry`. Canonical input/output schemas and annotations come from trusted contracts. T0 omits `internship_scout`; review leaves it absent; approval makes T1 discover it; tools/call executes the selected version and produces structured results. Upgrade/rollback select the persisted active version. Failed transaction commits leave no partial installation.

`ToolChangeAdapter` preserves the future connected-notification boundary. The current endpoint uses rediscovery.

## Access and limits

Host/Origin checks and 64KiB bounds apply before processing. Non-loopback access requires a bearer token of at least 24 characters. Unauthorized calls return 401 without WWW-Authenticate; origin violations return 403. The development token is single-owner authentication, not complete OAuth or separate human identity. Public production requires TLS and owner authentication distinct from agent credentials.

The evidence establishes the implemented protocol surface, not universal MCP certification or Amazon client integration. See [simulator scope](ALEXA_INTEGRATION.md).
