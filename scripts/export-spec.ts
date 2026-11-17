import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { capabilitySchema } from "../src/forge/spec";
import { demoPlan } from "../src/forge/compiler";
import { scoutRequest } from "../src/forge/fixtures";
await mkdir("packages/forgespec/examples", { recursive: true });
await writeFile(
  "packages/forgespec/schema.json",
  JSON.stringify(z.toJSONSchema(capabilitySchema), null, 2),
);
await writeFile(
  "packages/forgespec/examples/internship-scout.json",
  JSON.stringify(demoPlan(scoutRequest), null, 2),
);
console.log("Exported ForgeSpec schema and runnable capability example.");
