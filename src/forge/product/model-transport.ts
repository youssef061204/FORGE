import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { assertPaidActionAllowed } from "../cost-policy";
import {
  boundedResponse,
  LocalMissionModel,
  localModelEndpoint,
} from "./local-model";
import type { ModelUsage } from "./provider";

export type GenerationRequest = {
  stage: "plan" | "implementation";
  system: string;
  context: unknown;
  schema?: Record<string, unknown>;
  maxTokens: number;
};
export interface StructuredTransport {
  readonly mode: "local" | "live" | "test";
  status(): Promise<{ ready: boolean; label: string; reason?: string }>;
  generate(
    request: GenerationRequest,
  ): Promise<{ text: string; usage: ModelUsage }>;
}

export class LocalStructuredTransport implements StructuredTransport {
  readonly mode = "local" as const;
  private readonly probe: LocalMissionModel;
  private readonly endpoint: URL;
  constructor(
    readonly model = process.env.FORGE_LOCAL_MODEL ?? "qwen2.5:7b-instruct",
    endpoint = process.env.FORGE_LOCAL_MODEL_URL ?? "http://127.0.0.1:11435",
    private readonly http: typeof fetch = fetch,
  ) {
    this.probe = new LocalMissionModel(model, endpoint, http);
    this.endpoint = localModelEndpoint(endpoint);
  }
  async status() {
    const result = await this.probe.status();
    return { ...result, label: "Local generation" };
  }
  async generate(request: GenerationRequest) {
    if (
      !Number.isInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.maxTokens > 6000
    )
      throw new Error("A bounded output token limit is required");
    const ready = await this.status();
    if (!ready.ready)
      throw new Error(ready.reason ?? "Cached local model is unavailable");
    const started = performance.now();
    const usage: ModelUsage = {
      provider: "ollama-local",
      model: this.model,
      region: null,
      calls: 1,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokensComplete: false,
      schemaValidated: false,
    };
    let response: Awaited<ReturnType<typeof boundedResponse>>;
    try {
      response = await boundedResponse(
        await this.http(new URL("/api/chat", this.endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(180000),
          body: JSON.stringify({
            model: this.model,
            stream: false,
            ...(request.schema ? { format: request.schema } : {}),
            keep_alive: "10m",
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: JSON.stringify(request.context) },
            ],
            options: {
              temperature: 0,
              num_ctx: 16384,
              num_thread: 4,
              num_predict: request.maxTokens,
              seed: 147,
            },
          }),
        }),
      );
    } catch (error) {
      usage.durationMs = performance.now() - started;
      usage.stageTimings = { [request.stage]: usage.durationMs };
      if (error instanceof Error) Object.assign(error, { usage });
      throw error;
    }
    Object.assign(usage, {
      durationMs: performance.now() - started,
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
      tokensComplete:
        typeof response.prompt_eval_count === "number" &&
        typeof response.eval_count === "number",
      stageTimings: { [request.stage]: performance.now() - started },
    });
    if (
      !response.done ||
      response.done_reason !== "stop" ||
      response.model !== this.model ||
      typeof response.message?.content !== "string"
    ) {
      const error = new Error(
        "Local generation did not finish within its bounded response; no fallback was used",
      );
      Object.assign(error, {
        usage,
        modelFailure: {
          stage: request.stage,
          doneReason: response.done_reason,
          content: String(response.message?.content ?? "").slice(0, 32000),
        },
      });
      throw error;
    }
    return { text: response.message.content as string, usage };
  }
}

// Preserved provider boundary, tested with injected SDK clients only in this pass.
// The cost check precedes credential-chain construction and every dispatch.
export class BedrockStructuredTransport implements StructuredTransport {
  readonly mode = "live" as const;
  private readonly client: BedrockRuntimeClient;
  private calls = 0;
  constructor(
    readonly model = process.env.BEDROCK_MODEL_ID ??
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    readonly region = process.env.AWS_REGION ?? "ca-central-1",
    readonly profile = process.env.AWS_PROFILE ?? "forge",
    private readonly requestCap = Number(
      process.env.FORGE_MISSION_REQUEST_CAP ?? 0,
    ),
  ) {
    assertPaidActionAllowed("Amazon Bedrock grounded planning");
    if (!Number.isInteger(requestCap) || requestCap < 1 || requestCap > 500)
      throw new Error("Bedrock requires an explicit bounded request cap");
    this.client = new BedrockRuntimeClient({
      region,
      credentials: fromNodeProviderChain({ profile }),
      maxAttempts: 1,
    });
  }
  async status() {
    return {
      ready: true,
      label: "Live generation · Amazon Bedrock",
      reason: "Access is checked on invocation; no fixture fallback",
    };
  }
  async generate(request: GenerationRequest) {
    assertPaidActionAllowed("Amazon Bedrock grounded planning");
    if (this.calls >= this.requestCap)
      throw new Error("Bedrock transport request cap exhausted");
    if (
      !Number.isInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.maxTokens > 6000
    )
      throw new Error("A bounded output token limit is required");
    this.calls++;
    const started = performance.now();
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.model,
        system: [
          {
            text:
              request.system +
              (request.schema
                ? "\nRequired JSON schema:\n" + JSON.stringify(request.schema)
                : ""),
          },
        ],
        messages: [
          {
            role: "user",
            content: [{ text: JSON.stringify(request.context) }],
          },
        ],
        inferenceConfig: { maxTokens: request.maxTokens, temperature: 0 },
      }),
      { abortSignal: AbortSignal.timeout(180000) },
    );
    const text = response.output?.message?.content?.find(
      (part) => "text" in part,
    )?.text;
    const usage: ModelUsage = {
      provider: "amazon-bedrock",
      model: this.model,
      region: this.region,
      requestId: response.$metadata.requestId,
      calls: 1,
      durationMs: performance.now() - started,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      tokensComplete:
        response.usage?.inputTokens !== undefined &&
        response.usage?.outputTokens !== undefined,
      schemaValidated: false,
      stageTimings: { [request.stage]: performance.now() - started },
    };
    if (!text || response.stopReason !== "end_turn") {
      const error = new Error(
        "Bedrock did not return a complete bounded response; no fixture fallback was used",
      );
      Object.assign(error, { usage });
      throw error;
    }
    return { text, usage };
  }
}
