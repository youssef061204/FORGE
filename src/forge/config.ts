import { z } from "zod";
export const configSchema = z
  .object({
    DEMO_MODE: z.enum(["true", "false"]).default("true"),
    FORGE_FREE_ONLY: z.enum(["true", "false"]).default("true"),
    FORGE_APP_MODE: z.enum(["product", "development", "test"]).optional(),
    FORGE_PLANNER_PROVIDER: z.enum(["local", "bedrock", "offline"]).optional(),
    FORGE_RUNTIME_MODE: z.enum(["fixture", "aws"]).optional(),
    MODEL_PROVIDER: z.enum(["demo", "bedrock"]).optional(),
    STORE_PROVIDER: z.enum(["local", "dynamodb"]).default("local"),
    SANDBOX_PROVIDER: z.enum(["process", "docker"]).default("process"),
    BEDROCK_MODEL_ID: z.string().min(1).optional(),
    DYNAMODB_TABLE: z.string().min(1).optional(),
    FORGE_API_TOKEN: z.string().min(24).optional(),
    FORGE_EVENT_BUS: z.string().optional(),
    FORGE_LOG_GROUP: z.string().optional(),
    FORGE_KMS_KEY_ID: z.string().min(1).optional(),
    FORGE_ARTIFACT_BUCKET: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    const provider =
      config.FORGE_RUNTIME_MODE === "aws"
        ? "bedrock"
        : (config.MODEL_PROVIDER ?? "demo");
    if (config.FORGE_FREE_ONLY === "true") {
      const paidSettings = [
        ["FORGE_PLANNER_PROVIDER", config.FORGE_PLANNER_PROVIDER === "bedrock"],
        ["MODEL_PROVIDER", provider === "bedrock"],
        ["STORE_PROVIDER", config.STORE_PROVIDER === "dynamodb"],
        ["FORGE_EVENT_BUS", Boolean(config.FORGE_EVENT_BUS)],
        ["FORGE_LOG_GROUP", Boolean(config.FORGE_LOG_GROUP)],
        ["FORGE_KMS_KEY_ID", Boolean(config.FORGE_KMS_KEY_ID)],
        ["FORGE_ARTIFACT_BUCKET", Boolean(config.FORGE_ARTIFACT_BUCKET)],
      ] as const;
      for (const [setting, enabled] of paidSettings)
        if (enabled)
          context.addIssue({
            code: "custom",
            path: [setting],
            message: `${setting} selects a paid cloud feature blocked by FORGE_FREE_ONLY=true`,
          });
    }
    if (
      config.FORGE_RUNTIME_MODE &&
      config.MODEL_PROVIDER &&
      config.MODEL_PROVIDER !==
        (config.FORGE_RUNTIME_MODE === "aws" ? "bedrock" : "demo")
    )
      context.addIssue({
        code: "custom",
        path: ["MODEL_PROVIDER"],
        message:
          "MODEL_PROVIDER conflicts with FORGE_RUNTIME_MODE; remove the legacy setting or make them agree",
      });
    if (provider === "bedrock" && !config.BEDROCK_MODEL_ID)
      context.addIssue({
        code: "custom",
        message: "BEDROCK_MODEL_ID is required",
        path: ["BEDROCK_MODEL_ID"],
      });
    if (config.STORE_PROVIDER === "dynamodb" && !config.DYNAMODB_TABLE)
      context.addIssue({
        code: "custom",
        message: "DYNAMODB_TABLE is required",
        path: ["DYNAMODB_TABLE"],
      });
    if (config.DEMO_MODE === "false")
      context.addIssue({
        code: "custom",
        message:
          "Live external source/resume/notification adapters are not configured; DEMO_MODE=false is unavailable in this prototype",
        path: ["DEMO_MODE"],
      });
  })
  .transform((config) => ({
    ...config,
    MODEL_PROVIDER:
      config.FORGE_RUNTIME_MODE === "aws"
        ? ("bedrock" as const)
        : (config.MODEL_PROVIDER ?? ("demo" as const)),
    FORGE_RUNTIME_MODE:
      config.FORGE_RUNTIME_MODE ??
      (config.MODEL_PROVIDER === "bedrock"
        ? ("aws" as const)
        : ("fixture" as const)),
  }));
export function getConfig() {
  return configSchema.parse(process.env);
}
