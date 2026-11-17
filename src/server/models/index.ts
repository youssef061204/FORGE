/**
 * Which model transport is in use. Live Ollama when one is reachable on
 * loopback; the scripted stand-in only when FORGE_MODEL_TRANSPORT=scripted
 * (tests). With neither, live generation is off and the UI says so.
 */
import { ScriptedTransport, type GenerateRequest, type ModelTransport } from "../../core/synth/transport";
import { chooseModel, discoverOllama, OllamaTransport, type OllamaModel } from "./ollama";
import { SCRIPTED_ANSWERS } from "./scripted-answers";

export type ModelStatus =
  | { state: "live"; url: string; model: string; models: OllamaModel[] }
  | { state: "scripted" }
  | { state: "offline"; reason: string };

let cache: { at: number; status: ModelStatus; transport?: ModelTransport } | undefined;

/** Deterministic answers for the scripted stand-in, keyed by request words. */
export function scriptedResponder(request: GenerateRequest): string {
  const req = /Request: ([^\n]+)/g;
  let last = "";
  for (const m of request.prompt.matchAll(req)) last = m[1];
  const entry = SCRIPTED_ANSWERS.find((a) => a.match.test(last));
  if (request.purpose === "intent")
    return JSON.stringify(entry?.intent ?? { title: "Scripted tool", restatement: last, outputs: [], needs: ["file.read", "file.write"], feasible: true, missing: "" });
  const list = entry?.recipes ?? (entry?.recipe ? [entry.recipe] : []);
  // Drafts carry seeds 1..K; repairs add 1000. Cycle through the list by seed.
  const pick = list.length ? list[(request.seed - 1 + list.length) % list.length] : undefined;
  return JSON.stringify(pick ?? { inputs: [], steps: [], outputs: [] });
}

export async function modelStatus(force = false): Promise<{ status: ModelStatus; transport?: ModelTransport }> {
  if (!force && cache && Date.now() - cache.at < 15_000) return cache;
  if (process.env.FORGE_MODEL_TRANSPORT === "scripted") {
    cache = { at: Date.now(), status: { state: "scripted" }, transport: new ScriptedTransport(scriptedResponder, "scripted", 4) };
    return cache;
  }
  if (process.env.FORGE_MODE === "showcase") {
    cache = { at: Date.now(), status: { state: "offline", reason: "Showcase mode plays recorded builds." } };
    return cache;
  }
  const found = await discoverOllama(process.env.FORGE_OLLAMA_URL);
  if (!found) {
    cache = { at: Date.now(), status: { state: "offline", reason: "No local Ollama server was found on 127.0.0.1:11434 or :11435." } };
    return cache;
  }
  const preferred = process.env.FORGE_MODEL ?? undefined;
  const model = chooseModel(found.models, preferred);
  if (!model) {
    cache = { at: Date.now(), status: { state: "offline", reason: "Ollama is running but has no usable model installed. FORGE never downloads one for you." } };
    return cache;
  }
  cache = { at: Date.now(), status: { state: "live", url: found.url, model, models: found.models }, transport: new OllamaTransport(found.url, model) };
  return cache;
}

export function selectModel(name: string) {
  process.env.FORGE_MODEL = name;
  cache = undefined;
}
