import { mkdir, writeFile } from "node:fs/promises";
import { LocalMissionModel } from "../src/forge/product/local-model";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { ProductRuntime } from "../src/forge/product/runtime";
import {
  WorkspaceConnector,
  importWorkspaceDocument,
  readWorkspaceArtifact,
} from "../src/forge/product/workspace";
import { MemoryStateStore } from "../src/forge/store";
import { digest } from "../src/forge/hash";
const label = process.env.FORGE_LOCAL_PROOF_LABEL ?? "smoke";
if (!/^[a-z0-9-]{1,50}$/.test(label))
  throw new Error("Invalid local proof label");
const directory = `artifacts/local-synthesis/${label}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(directory, { recursive: true });
console.log(`Local proof evidence: ${directory}`);
const store = new MemoryStateStore();
await importWorkspaceDocument(store, {
  name: "orders.csv",
  format: "csv",
  text: "item,quantity,price\nNotebook,3,5\nPen,10,2\nLamp,2,25\n",
});
const fabric = new ConnectorFabric();
fabric.register("workspace", new WorkspaceConnector(store));
let chatCalls = 0;
const chatBudget = Number(process.env.FORGE_LOCAL_PROOF_CHAT_BUDGET ?? 4);
if (!Number.isInteger(chatBudget) || chatBudget < 1 || chatBudget > 6)
  throw new Error("Local proof chat budget must be between 1 and 6");
const localHttp: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "http://127.0.0.1:11435")
    throw new Error(
      "This proof permits only the isolated loopback Ollama server",
    );
  const chat = url.pathname === "/api/chat";
  if (chat) {
    if (chatCalls >= chatBudget)
      throw new Error("Local proof exhausted its explicit chat request budget");
    chatCalls++;
  }
  const response = await fetch(input, init);
  if (chat) {
    await writeFile(
      `${directory}/chat-${chatCalls}.json`,
      JSON.stringify(
        {
          request: JSON.parse(String(init?.body)),
          response: await response.clone().json(),
        },
        null,
        2,
      ),
    );
  }
  return response;
};
const model = new LocalMissionModel(undefined, undefined, localHttp);
const plan = model.plan.bind(model);
model.plan = async (context) => {
  const result = await plan(context);
  await writeFile(
    directory + "/model-" + Date.now() + ".json",
    JSON.stringify(result, null, 2),
  );
  return result;
};
const runtime = new ProductRuntime(store, fabric, model);
const start = performance.now();
try {
  const result = await runtime.ask(
    "Read orders.csv and save totals.json containing a JSON object mapping each item name to quantity times price as numbers. Compute the values from the rows; include every item.",
  );
  await writeFile(
    directory + "/proposal.json",
    JSON.stringify(result, null, 2),
  );
  if (!result.tool)
    throw new Error(`Compiler returned ${result.state} instead of software`);
  const tool = result.tool;
  await runtime.approve(tool.id, tool.hash, tool.permissions);
  const run = await runtime.run(tool.id, "local-smoke");
  if (run.status !== "done") throw new Error(run.error ?? "Run failed");
  const output = await readWorkspaceArtifact(
    store,
    run.receipts.find((receipt) => receipt.operation === "workspace.save")!
      .responseId!,
  );
  const expected = { Notebook: 15, Pen: 20, Lamp: 50 };
  const actual = JSON.parse(output.text);
  if (digest(actual) !== digest(expected))
    throw new Error("Generated output failed the independent semantic oracle");
  const report = {
    at: new Date().toISOString(),
    passed: true,
    provider: tool.usage.provider,
    model: tool.usage.model,
    paidRequests: 0,
    chatCalls,
    usage: tool.usage,
    builds: [...runtime.builds.values()],
    durationMs: performance.now() - start,
    hash: tool.hash,
    permissions: tool.permissions,
    checks: tool.evidence.checks,
    replay: tool.evidence.replay,
    run,
    output: { name: output.name, sha256: output.sha256, actual, expected },
  };
  await writeFile(directory + "/proof.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    at: new Date().toISOString(),
    passed: false,
    paidRequests: 0,
    chatCalls,
    durationMs: performance.now() - start,
    error: error instanceof Error ? error.message : "Local proof failed",
    modelFailure: (error as { modelFailure?: unknown }).modelFailure,
    usage: (error as { usage?: unknown }).usage,
    builds: [...runtime.builds.values()],
  };
  await writeFile(directory + "/failure.json", JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report));
  process.exitCode = 1;
}
