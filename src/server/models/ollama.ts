/**
 * Streaming Ollama transport. Loopback only (through egressFetch), never pulls
 * a model, refuses cloud models, and stops cleanly when a build is aborted.
 */
import { AbortedError, type GenerateRequest, type GenerateResult, type ModelTransport } from "../../core/synth/transport";
import { egressFetch, isLoopbackUrl } from "../egress";

export const OLLAMA_PORTS = [11434, 11435];

export type OllamaModel = { name: string; size: number; parameterSize?: string; quantization?: string; family?: string; remote: boolean };

export async function listModels(base: string, timeoutMs = 1500): Promise<OllamaModel[]> {
  const res = await egressFetch(new URL("/api/tags", base), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const body = (await res.json()) as { models?: { name: string; size: number; remote_host?: string; details?: { parameter_size?: string; quantization_level?: string; family?: string } }[] };
  return (body.models ?? []).map((m) => ({
    name: m.name,
    size: m.size,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    family: m.details?.family,
    // Cloud-proxied models in Ollama carry a remote host or a ":cloud" tag.
    remote: !!m.remote_host || /[:-]cloud\b/.test(m.name),
  }));
}

export type Discovery = { url: string; models: OllamaModel[] } | undefined;

export async function discoverOllama(preferred?: string): Promise<Discovery> {
  const urls = preferred ? [preferred] : OLLAMA_PORTS.map((p) => `http://127.0.0.1:${p}`);
  for (const url of urls) {
    if (!isLoopbackUrl(url)) continue;
    try {
      const models = (await listModels(url)).filter((m) => !m.remote);
      return { url, models };
    } catch {
      /* try the next port */
    }
  }
  return undefined;
}

/** Prefer a 7B-class instruct model; fall back to the largest local one that fits. */
export function chooseModel(models: OllamaModel[], requested?: string): string | undefined {
  if (requested && models.some((m) => m.name === requested)) return requested;
  const usable = models.filter((m) => !/llava|embed|vision/i.test(m.name));
  const preferred = usable.find((m) => /qwen2\.5:7b-instruct/.test(m.name)) ?? usable.find((m) => /instruct|coder/.test(m.name) && m.size < 9e9);
  return (preferred ?? usable.sort((a, b) => a.size - b.size).find((m) => m.size < 9e9) ?? usable[0])?.name;
}

export class OllamaTransport implements ModelTransport {
  readonly provenance = "live" as const;
  readonly id: string;
  constructor(
    readonly base: string,
    readonly model: string,
    private readonly numCtx = 8192,
  ) {
    if (!isLoopbackUrl(base)) throw new Error("Ollama must be on this computer (a loopback address)");
    this.id = `ollama:${model}`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    let response: Response;
    try {
      response = await egressFetch(new URL("/api/chat", this.base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          keep_alive: "30m",
          format: request.schema ?? "json",
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          options: { temperature: request.temperature, seed: request.seed, num_predict: request.maxTokens, num_ctx: this.numCtx },
        }),
      });
    } catch (error) {
      if (request.signal?.aborted) throw new AbortedError();
      throw error;
    }
    if (!response.ok || !response.body) throw new Error(`Ollama answered ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let promptTokens = 0;
    let completionTokens = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number; error?: string };
          if (chunk.error) throw new Error(chunk.error);
          const piece = chunk.message?.content ?? "";
          if (piece) {
            text += piece;
            request.onDelta?.(piece);
          }
          if (chunk.done) {
            promptTokens = chunk.prompt_eval_count ?? 0;
            completionTokens = chunk.eval_count ?? 0;
          }
        }
      }
    } catch (error) {
      if (request.signal?.aborted) throw new AbortedError();
      throw error;
    } finally {
      reader.releaseLock();
    }
    return { text, promptTokens, completionTokens, ms: Date.now() - started };
  }
}
