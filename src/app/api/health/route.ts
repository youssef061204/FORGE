import { getConfig } from "@/forge/config";
import { productMode } from "@/forge/product/runtime-mode";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    const c = getConfig();
    const selection = productMode();
    return Response.json({
      status: "ok",
      product: "FORGE",
      demo: c.DEMO_MODE === "true",
      runtimeMode: c.FORGE_RUNTIME_MODE,
      appMode: selection.mode,
      freeOnly: c.FORGE_FREE_ONLY === "true",
      interactiveCompiler: {
        provider:
          selection.provider === "offline"
            ? "offline"
            : selection.provider === "bedrock"
              ? "Amazon Bedrock"
              : "ollama-local",
        modelId:
          selection.provider === "offline"
            ? null
            : selection.provider === "bedrock"
              ? c.BEDROCK_MODEL_ID
              : (process.env.FORGE_LOCAL_MODEL ?? "qwen2.5:7b-instruct"),
        readiness: "not-probed",
        pipeline: selection.recorded
          ? "recorded-test"
          : "grounded-plan-and-typed-implementation",
      },
      legacyCompilerScope:
        "Reproducible fixture and historical compiler facilities",
      model: c.MODEL_PROVIDER,
      compilerProvider:
        c.MODEL_PROVIDER === "bedrock"
          ? "Amazon Bedrock"
          : "Deterministic Fixture Compiler",
      modelId:
        c.MODEL_PROVIDER === "bedrock"
          ? c.BEDROCK_MODEL_ID
          : "deterministic-planner",
      store: c.STORE_PROVIDER,
      sandbox: c.SANDBOX_PROVIDER,
      cloudConnectivity: "not-probed",
    });
  } catch {
    return Response.json({ status: "invalid-configuration" }, { status: 503 });
  }
}
