/**
 * "Simulate an assistant": a real MCP client (the SDK's) connects to this
 * FORGE over HTTP and walks the loop: list tools, find none that fits, ask
 * FORGE, wait for a person to approve in the UI, list again, call the tool.
 * Its traffic shows up on the Assistants wire console like any client's.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { SAMPLES } from "../../showcase/samples";
import type { Bus } from "../bus";

export type SimStep = { at: string; text: string; buildId?: string };

const g = globalThis as typeof globalThis & { __sim?: { steps: SimStep[]; running: boolean } };

export function simulation() {
  return g.__sim ?? { steps: [], running: false };
}

export async function simulate(base: string, bus: Bus) {
  if (g.__sim?.running) return;
  const state = { steps: [] as SimStep[], running: true };
  g.__sim = state;
  const say = (text: string, buildId?: string) => {
    state.steps.push({ at: new Date().toISOString(), text, buildId });
    bus.publish({ t: "mcp.wire", session: "simulator", direction: "in", message: { note: text, buildId }, caption: text, at: new Date().toISOString() });
  };
  const client = new Client({ name: "forge-simulated-assistant", version: "1.0.0" });
  try {
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      changed++;
    });
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base)));
    const sample = SAMPLES.find((s) => s.id === "inventory")!;
    const request = sample.requests[0].text;
    say(`Simulated assistant: someone asked me “${request}”`);
    const before = (await client.listTools()).tools.map((t) => t.name);
    say(`I have ${before.length} tools. None of them reads an inventory file, so I'll ask FORGE.`);
    const res = await client.callTool({ name: "forge_build", arguments: { request, files: [{ name: sample.file.name, text: sample.file.text }] } });
    const text = (res.content as { text: string }[])[0]?.text ?? "";
    const buildId = /Build id: (b_[\w-]+)/.exec(text)?.[1];
    if (!buildId) throw new Error(text || "FORGE did not start a build");
    say("FORGE is building it. I can't approve it myself: a person has to, in FORGE.", buildId);
    const deadline = Date.now() + 15 * 60_000;
    while (!changed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
    if (!changed) throw new Error("Nobody approved the tool within 15 minutes.");
    const after = (await client.listTools()).tools.map((t) => t.name);
    const fresh = after.find((n) => !before.includes(n));
    say(`My tool list just changed: ${fresh ?? "(no new tool)"} appeared.`);
    if (!fresh) throw new Error("The new tool is not in the list.");
    const out = await client.callTool({ name: fresh, arguments: { inventory: sample.file.name } });
    say(`I called ${fresh}. FORGE answered: ${((out.content as { text: string }[])[0]?.text ?? "").slice(0, 400)}`);
  } catch (error) {
    say(`Stopped: ${(error as Error).message}`);
  } finally {
    state.running = false;
    await client.close().catch(() => undefined);
  }
}
