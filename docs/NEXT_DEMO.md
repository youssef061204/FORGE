# FORGE: 175-second demo

Status: tested story, October 23, 2026. The [real local-model browser proof](../artifacts/local-synthesis/browser-proof.json) passes the complete orders → download → MCP invocation → natural v1.1.0 → fresh approval → revoke sequence below. Its [runner](../artifacts/local-synthesis/browser-report.json) passed 1/1 in 73.006 seconds overall. The actual [main production flow](../artifacts/local-synthesis/production-proof.json) and [process restart](../artifacts/local-synthesis/production-restart-proof.json) also pass. The final full corpus completed only 7/18 missions; this is a rehearsed controlled example, not an arbitrary-request reliability claim. This script uses no paid service, cloud inference, Google reconnection or Spotify.

The story is one useful tool becoming available to an assistant: **missing tool → generated software → checked access → real output → persistent MCP tool → changed version → revoked authority**. Keep code off screen. Use the browser and the actual MCP client's compact tool/result view. Do not substitute a hand-edited tool list for a server response.

## Preparation

The delivered main instance is **<http://127.0.0.1:3108/>** and already contains a real installed proof tool. For recording a genuine T0 with no generated tool, start a separate local container with a **new, unused `forge-demo-data` volume** and port **3110**. The command below is a preparation recipe; this isolated container has not been started or rehearsed by the verification. It uses the verified existing image and cached host model, mounts no main volume/private environment file, and provisions no cloud resource:

```powershell
docker run --detach --name forge-demo `
  --publish "127.0.0.1:3110:3000" `
  --mount "type=volume,source=forge-demo-data,target=/app/data" `
  --env DEMO_MODE=true `
  --env FORGE_RUNTIME_MODE=fixture `
  --env MODEL_PROVIDER=demo `
  --env STORE_PROVIDER=local `
  --env SANDBOX_PROVIDER=process `
  --env FORGE_DATA_DIR=/app/data `
  --env FORGE_FREE_ONLY=true `
  --env FORGE_INTERACTIVE_PROVIDER=local `
  --env FORGE_LOCAL_MODEL=qwen2.5:7b-instruct `
  --env FORGE_LOCAL_MODEL_URL=http://host.docker.internal:11435 `
  forge-app:local
```

The named volume is created automatically if absent. Use unused names rather than resetting any existing volume. Open the **recording instance at <http://127.0.0.1:3110/>** at 1440×900 and point the recording's MCP client to **`http://127.0.0.1:3110/api/mcp`**. Check its Local model status before recording. The delivered main instance remains on **3108** with its existing tools and Google settings intact. Docker-to-host model access was verified by the main production proof; rehearse the isolated instance before filming.

Prepare this small owner-created `orders.csv`:

```csv
item,quantity,price
Notebook,4,5
Pen,6,2
Lamp,3,25
```

These are synthetic example records. The correct initial JSON is `{"Notebook":20,"Pen":12,"Lamp":75}`; the extension adds `"grandTotal":107`. Rehearse both outputs independently. Use the same official MCP SDK client against `/api/mcp` for T0, T1, invocation and the final revoked invocation; retain the real JSON evidence. Do not expose owner tokens in the capture.

## Recording sequence

| Time      | Show                                                                                                                                   | Say                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:12 | Home and the live MCP tool list. Highlight that the requested totals tool is absent.                                                   | “An assistant can only use tools it has. FORGE builds the missing software.”                                                                        |
| 0:12–0:28 | Upload `orders.csv`. Submit the exact request below. Keep the input visible.                                                           | “Calculate sales totals from my file. This is a request over my own data, not a preset routine.”                                                    |
| 0:28–1:00 | Actual Building, Testing and read-only replay progress. Leave generation's elapsed time visible.                                       | “A cached local model writes the software. FORGE compiles it and checks its behavior before allowing a write. No paid model or cloud call is used.” |
| 1:00–1:18 | Review the exact orders-file read permission, local-output permission, passed checks and zero replay writes. Approve exact access.     | “It can read this file and create a local output. It cannot send email, touch other files or gain new authority by writing code.”                   |
| 1:18–1:38 | Run, download and open the actual output next to the input. Then show T1 from the live MCP client and invoke the newly installed tool. | “Here is the real report. The tool that was missing now exists, and the assistant can discover and invoke it.”                                      |
| 1:38–2:15 | Choose Edit tool. Submit the extension below. Show v1.0.0 → v1.1.0 and fresh approval. Keep actual generation latency visible.         | “Now include the grand total. FORGE changes the software; the new version needs its own approval.”                                                  |
| 2:15–2:32 | Refresh Tools, run the approved version and open the result with grandTotal 107.                                                       | “It persists. This is installed software I can use again.”                                                                                          |
| 2:32–2:45 | Revoke access. Immediately invoke the same MCP tool through the same client and show the actual denial.                                | “Generated code does not own its permissions. Revocation stops even a direct invocation.”                                                           |
| 2:45–2:55 | Briefly show Inspect evidence, then the Twin labeled Simulation. Return to the output.                                                 | “The deeper system includes sandboxing and a simulated proving ground. The point is the result: when the assistant lacks a tool, FORGE builds it.”  |

Initial request:

> Read orders.csv and save totals.json containing a JSON object mapping each item name to quantity times price as numbers. Compute the values from the rows; include every item.

Edit request:

> Update that tool: keep calculating every item's quantity times price from orders.csv. Also include a numeric grandTotal key equal to the sum of all item totals in the same totals.json object. Compute everything from the rows.

## Evidence and timing rules

- The 175 seconds is the video budget, not a measured end-to-end user timing. The current browser's initial tool recorded 22.474 seconds of inference across two local requests. The full automated lifecycle took 73.006 seconds; human recording and approval times must come from the actual rehearsal.
- If a real generation exceeds its segment, use a visibly labeled time cut such as “37 seconds later” and retain the real duration. Never present accelerated footage as real-time inference.
- Show the denied revoked invocation as an actual authority-boundary attack. Do not call it a measured prompt-injection block rate. The separate 300-attempt broker corpus is historical and differently scoped.
- Use the tested v1.1.0 edit path with fresh approval. Show actual inference, not a recorded provider response labeled as live synthesis.
- Do not claim native Alexa+ deployment. Say “self-hosted MCP server and assistant experience for the Alexa+ track.” Historical Bedrock work can be one spoken sentence or an evidence link, dated and separate from this free local run.
- Physical microphone recognition needs a manual rehearsal. Typed input is the dependable recording path; injected speech-browser tests do not prove a physical device.

Final acceptance, corpus failures and release evidence belong in [NEXT_REPORT.md](NEXT_REPORT.md), not in additional feature tours.
