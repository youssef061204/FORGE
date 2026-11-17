import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { capsuleSchema, verifyCapsule } from "../packages/forge-capability";
const file = process.argv[2];
if (file) {
  const result = verifyCapsule(JSON.parse(await readFile(file, "utf8")));
  console.log(
    JSON.stringify(
      {
        format: result.capsule.payload.format,
        signature: result.signature,
        publisherTrust: result.publisherTrust,
        fingerprint: result.fingerprint,
        id: result.capsule.payload.manifest.id,
        inheritedPermissions: 0,
      },
      null,
      2,
    ),
  );
} else {
  await writeFile(
    "packages/forge-capability/schema.json",
    JSON.stringify(z.toJSONSchema(capsuleSchema), null, 2) + "\n",
  );
  console.log("Wrote forgecap/v1 JSON Schema");
}
