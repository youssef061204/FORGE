import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createBedrockRuntimeClient } from "../../src/forge/models";
import { assertPaidActionAllowed } from "../../src/forge/cost-policy";
const path = "artifacts/ml/paid-requests.json";
type Entry = {
  index: number;
  at: string;
  status: string;
  requestId?: string;
  durationMs?: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
};
/** Single sequential benchmark process. Reserve before sending; failed attempts consume budget. */
export async function meteredClient() {
  assertPaidActionAllowed("Paid Amazon Bedrock benchmark");
  await mkdir("artifacts/ml", { recursive: true });
  let entries: Entry[] = [];
  try {
    entries = JSON.parse(await readFile(path, "utf8")).requests;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const client = createBedrockRuntimeClient();
  client.middlewareStack.add(
    (next) => async (args) => {
      assertPaidActionAllowed("Paid Amazon Bedrock benchmark");
      if (entries.length >= 20)
        throw new Error("Authorized paid request cap (20) reached");
      const entry: Entry = {
          index: entries.length + 1,
          at: new Date().toISOString(),
          status: "reserved",
        },
        started = performance.now();
      entries.push(entry);
      const save = () =>
        writeFile(
          path,
          JSON.stringify(
            {
              cap: 20,
              profile: "forge",
              region: "ca-central-1",
              model: process.env.BEDROCK_MODEL_ID,
              requests: entries,
            },
            null,
            2,
          ),
        );
      await save();
      try {
        const result = await next(args),
          out = result.output as {
            $metadata?: { requestId?: string };
            usage?: { inputTokens?: number; outputTokens?: number };
          };
        entry.status = "succeeded";
        entry.requestId = out.$metadata?.requestId;
        entry.inputTokens = out.usage?.inputTokens;
        entry.outputTokens = out.usage?.outputTokens;
        return result;
      } catch (e) {
        entry.status = "failed";
        entry.error = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        entry.durationMs = Math.round(performance.now() - started);
        await save();
      }
    },
    { step: "initialize", name: "forgeAuthorizedPaidBudget" },
  );
  return client;
}
