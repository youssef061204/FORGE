import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getService } from "../server";
import { SecretVault } from "../vault";
import { ConnectorFabric } from "./fabric";
import {
  GoogleFabricConnector,
  LocalNotificationConnector,
  TwinFabricConnector,
} from "./builtin";
import { OpenApiConnector, parseOpenApi } from "./openapi";
import { ExternalMcpConnector } from "./external-mcp";
import { OfflineMissionModel } from "./provider";
import { ProductRuntime } from "./runtime";
import { connectionConfigSchema, emptyProductState } from "./contracts";
import { assertAllowedUrl } from "./network";
import { GroundedMissionModel } from "./grounded-model";
import {
  BedrockStructuredTransport,
  LocalStructuredTransport,
} from "./model-transport";
import { productMode } from "./runtime-mode";
import { WorkspaceConnector } from "./workspace";
import { freeOnlyEnabled, assertPaidActionAllowed } from "../cost-policy";

const globals = globalThis as typeof globalThis & {
  forgeProduct?: Promise<ProductRuntime>;
};
const vault = new SecretVault();
export function getProduct() {
  return (globals.forgeProduct ??= createProduct().catch((error) => {
    globals.forgeProduct = undefined;
    throw error;
  }));
}
async function createProduct() {
  const service = getService();
  const fabric = new ConnectorFabric();
  fabric.register("gmail", new GoogleFabricConnector("gmail", service.google));
  fabric.register(
    "calendar",
    new GoogleFabricConnector("calendar", service.google),
  );
  fabric.register("notifications", new LocalNotificationConnector());
  fabric.register("workspace", new WorkspaceConnector(service.store));
  fabric.register("twin", new TwinFabricConnector(service.store));
  const configs = (await service.store.read()).product?.connectors ?? [];
  for (const config of configs)
    if (config.enabled && !freeOnlyEnabled())
      fabric.register(
        config.id,
        config.kind === "openapi"
          ? new OpenApiConnector(config, vault)
          : new ExternalMcpConnector(config, vault),
      );
  // PRODUCT always uses a genuine provider. Legacy fixture routes are separate.
  const selection = productMode();
  let model: import("./provider").MissionModel =
    selection.provider === "offline"
      ? new OfflineMissionModel()
      : new GroundedMissionModel(
          selection.provider === "bedrock"
            ? new BedrockStructuredTransport()
            : new LocalStructuredTransport(),
        );
  if (process.env.FORGE_PRODUCT_TEST_RESPONSES) {
    if (
      selection.mode !== "test" ||
      process.env.NODE_ENV === "production" ||
      process.env.FORGE_RUNTIME_MODE === "aws"
    )
      throw new Error(
        "Recorded product testing requires explicit TEST mode outside packaged production",
      );
    const { loadRecordedModel, DevelopmentTasksConnector } =
      await import("./testing");
    model = await loadRecordedModel(process.env.FORGE_PRODUCT_TEST_RESPONSES);
    fabric.register("testtasks", new DevelopmentTasksConnector());
  }
  const runtime = new ProductRuntime(
    service.store,
    fabric,
    model,
    process.env.SANDBOX_PROVIDER === "docker" ? "docker" : "process",
  );
  await runtime.initialize();
  service.product = runtime;
  runtime.startScheduler();
  return runtime;
}

const importSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
    name: z.string().min(2).max(80),
    kind: z.enum(["openapi", "mcp"]),
    baseUrl: z.string().url(),
    domains: z.array(z.string()).min(1).max(10),
    operationAllowlist: z.array(z.string()).min(1).max(100),
    readOperations: z.array(z.string()).max(100).default([]),
    spec: z.string().max(60000).optional(),
    credential: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("bearer"),
          token: z.string().min(1).max(8000),
        }),
        z.object({
          kind: z.literal("api-key"),
          header: z.string().regex(/^X-[A-Za-z0-9-]+$/),
          token: z.string().min(1).max(8000),
        }),
      ])
      .optional(),
  })
  .strict();
export async function importConnection(raw: unknown) {
  assertPaidActionAllowed("External connector import with unverified pricing");
  const input = importSchema.parse(raw);
  assertAllowedUrl(input.baseUrl, input.domains);
  if (
    ["gmail", "calendar", "notifications", "twin", "workspace"].includes(
      input.id,
    )
  )
    throw new Error("Choose a distinct connector ID");
  const service = getService();
  const product = await getProduct();
  const existing = (await service.store.read()).product?.connectors.find(
    (c) => c.id === input.id,
  );
  if (existing)
    throw new Error(
      "This connector ID already exists; choose a distinct ID for the new connection",
    );
  const config = connectionConfigSchema.parse({
    ...input,
    spec: input.kind === "openapi" ? parseOpenApi(input.spec ?? "") : undefined,
    binding: randomUUID(),
    enabled: true,
  });
  const connector =
    config.kind === "openapi"
      ? new OpenApiConnector(config, vault)
      : new ExternalMcpConnector(config, vault);
  if (input.credential)
    await vault.set("connector:" + config.id, input.credential);
  // Discovery validates operation schemas before anything is persisted or exposed.
  await connector.describe();
  await service.store.transaction((state) => {
    const persisted = (state.product ??= emptyProductState());
    persisted.connectors.push(config);
  });
  product.fabric.register(config.id, connector);
  return { id: config.id, name: config.name, kind: config.kind };
}
