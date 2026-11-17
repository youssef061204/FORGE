import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { secureFetch } from "../src/forge/product/network";
import { parseOpenApi, OpenApiConnector } from "../src/forge/product/openapi";
import { connectionConfigSchema } from "../src/forge/product/contracts";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { SecretVault } from "../src/forge/vault";
import { digest } from "../src/forge/hash";
import { assertPaidActionAllowed } from "../src/forge/cost-policy";
assertPaidActionAllowed(
  "External public API verification (pricing unverified)",
);
const started = performance.now(),
  domains = ["petstore3.swagger.io"];
await mkdir("artifacts/product", { recursive: true });
try {
  const response = await secureFetch(
    "https://petstore3.swagger.io/api/v3/openapi.json",
    { method: "GET" },
    domains,
  );
  assert(response.ok, "Public OpenAPI spec download failed");
  const spec = parseOpenApi(await response.text());
  const config = connectionConfigSchema.parse({
    id: "publicpets",
    name: "Public Swagger test service",
    kind: "openapi",
    baseUrl: "https://petstore3.swagger.io/api/v3",
    domains,
    operationAllowlist: ["findPetsByStatus", "getInventory"],
    binding: "public-test-no-auth",
    spec,
  });
  const connector = new OpenApiConnector(
    config,
    new SecretVault("artifacts/product/public-vault"),
  );
  const fabric = new ConnectorFabric();
  fabric.register(config.id, connector);
  const resources = await fabric.discover();
  assert(resources[0].operations.length === 2);
  assert(
    resources[0].operations.every((operation) => operation.kind === "read"),
  );
  const context = {
    key: "public-read-only",
    mode: "replay" as const,
    now: new Date().toISOString(),
    observations: {},
  };
  const attempts = [];
  try {
    const pets = await fabric.invoke(
      "publicpets.findPetsByStatus",
      { status: "available" },
      context,
    );
    attempts.push({
      operation: "findPetsByStatus",
      schemaValidated: true,
      records: Array.isArray(pets.data) ? pets.data.length : null,
    });
  } catch (error) {
    attempts.push({
      operation: "findPetsByStatus",
      schemaValidated: false,
      error:
        error instanceof Error ? error.message : "Public response rejected",
    });
  }
  const result = await fabric.invoke("publicpets.getInventory", {}, context);
  assert(
    result.data &&
      typeof result.data === "object" &&
      !Array.isArray(result.data),
  );
  const evidence = {
    at: new Date().toISOString(),
    status: "verified",
    source: "Public Swagger Petstore 3 OpenAPI",
    specHash: digest(spec),
    operation: "publicpets.getInventory",
    schemaValidated: true,
    permission: fabric.operation("publicpets.getInventory").permission,
    publicTestRead: true,
    externalWrites: 0,
    records: Object.keys(result.data).length,
    durationMs: performance.now() - started,
    attempts,
  };
  await writeFile(
    "artifacts/product/openapi-public-proof.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} catch (error) {
  await writeFile(
    "artifacts/product/openapi-public-proof.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Public test service unavailable",
        externalWrites: 0,
      },
      null,
      2,
    ),
  );
  throw error;
}
