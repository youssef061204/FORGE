import { z } from "zod";

export function productMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const mode = z
    .enum(["product", "development", "test"])
    .parse(env.FORGE_APP_MODE ?? "product");
  const provider = z
    .enum(["local", "bedrock", "offline"])
    .parse(
      env.FORGE_PLANNER_PROVIDER ??
        (env.FORGE_INTERACTIVE_PROVIDER === "offline"
          ? "offline"
          : env.FORGE_RUNTIME_MODE === "aws"
            ? "bedrock"
            : "local"),
    );
  if (env.FORGE_PRODUCT_TEST_RESPONSES && mode !== "test")
    throw new Error(
      "Recorded model responses require explicit FORGE_APP_MODE=test; PRODUCT never uses test generation",
    );
  if (mode === "test" && env.NODE_ENV === "production")
    throw new Error(
      "TEST generation is disabled in a packaged production server",
    );
  return {
    mode,
    provider,
    recorded: mode === "test" && Boolean(env.FORGE_PRODUCT_TEST_RESPONSES),
  };
}
