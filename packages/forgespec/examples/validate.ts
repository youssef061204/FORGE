import { readFile } from "node:fs/promises";
import {
  validateCapability,
  topologicalOrder,
  derivePermissions,
} from "../index";

const capability = validateCapability(
  JSON.parse(
    await readFile(new URL("./internship-scout.json", import.meta.url), "utf8"),
  ),
);
console.log(
  JSON.stringify(
    {
      tool: capability.toolContract.name,
      operations: topologicalOrder(capability).map((node) => node.operation),
      permissions: derivePermissions(capability.nodes),
    },
    null,
    2,
  ),
);
