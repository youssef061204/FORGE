/**
 * The Crucible talks to models only through this interface. Implementations:
 * Ollama streaming (server/models/ollama.ts), scripted (here, for tests and
 * scripted tapes), and recorded tapes, which bypass generation entirely.
 */
export type GenerateRequest = {
  purpose: "intent" | "draft" | "repair";
  system: string;
  prompt: string;
  /** JSON Schema for structured output (Ollama `format`). */
  schema?: Record<string, unknown>;
  temperature: number;
  seed: number;
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
};
export type GenerateResult = { text: string; promptTokens: number; completionTokens: number; ms: number };

export interface ModelTransport {
  readonly id: string;
  readonly model: string;
  readonly provenance: "live" | "scripted";
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export class AbortedError extends Error {
  constructor() {
    super("generation was stopped");
    this.name = "AbortedError";
  }
}

/**
 * Deterministic stand-in: answers come from a function of the request. Text is
 * delivered in small chunks so the UI streams exactly as it would live.
 */
export class ScriptedTransport implements ModelTransport {
  readonly id = "scripted";
  readonly provenance = "scripted" as const;
  calls: GenerateRequest[] = [];
  constructor(
    private readonly respond: (request: GenerateRequest, call: number) => string,
    readonly model = "scripted",
    private readonly chunkDelayMs = 0,
  ) {}
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const call = this.calls.length;
    this.calls.push(request);
    const text = this.respond(request, call);
    const started = Date.now();
    for (let i = 0; i < text.length; i += 24) {
      if (request.signal?.aborted) throw new AbortedError();
      request.onDelta?.(text.slice(i, i + 24));
      if (this.chunkDelayMs) await new Promise((r) => setTimeout(r, this.chunkDelayMs));
    }
    return { text, promptTokens: Math.ceil(request.prompt.length / 4), completionTokens: Math.ceil(text.length / 4), ms: Date.now() - started };
  }
}
