import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseOpenApi, OpenApiConnector } from "../src/forge/product/openapi";
import { connectionConfigSchema } from "../src/forge/product/contracts";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { SecretVault } from "../src/forge/vault";
import { digest } from "../src/forge/hash";
import { assertPaidActionAllowed } from "../src/forge/cost-policy";
assertPaidActionAllowed(
  "External public API verification (pricing unverified)",
);
const started = performance.now();
await mkdir("artifacts/product", { recursive: true });
const spec = parseOpenApi(
  await readFile("scripts/fixtures/httpbin-openapi.json", "utf8"),
);
const config = connectionConfigSchema.parse({
  id: "publicjson",
  name: "HTTPBin read-only public test",
  kind: "openapi",
  baseUrl: "https://httpbin.org",
  domains: ["httpbin.org"],
  operationAllowlist: ["getJsonExample"],
  binding: "public-no-auth",
  spec,
});
try {
  const fabric = new ConnectorFabric();
  fabric.register(
    config.id,
    new OpenApiConnector(
      config,
      new SecretVault("artifacts/product/public-vault"),
    ),
  );
  const resources = await fabric.discover();
  assert(resources[0].operations.length === 1);
  const result = await fabric.invoke(
    "publicjson.getJsonExample",
    {},
    {
      key: "public-example",
      mode: "replay",
      now: new Date().toISOString(),
      observations: {},
    },
  );
  assert(
    result.data &&
      typeof result.data === "object" &&
      "slideshow" in result.data,
  );
  const evidence = {
    at: new Date().toISOString(),
    status: "verified",
    source:
      "Hand-authored controlled OpenAPI 3.1 contract for https://httpbin.org/json; actual public HTTPS invocation",
    schemaValidated: true,
    specHash: digest(spec),
    operation: resources[0].operations[0].id,
    permission: resources[0].operations[0].permission,
    externalWrites: 0,
    durationMs: performance.now() - started,
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
        externalWrites: 0,
        error:
          error instanceof Error ? error.message : "Public response rejected",
      },
      null,
      2,
    ),
  );
  throw error;
}
