# ForgeSpec

An MIT-licensed constrained specification for dynamically compiled, permission-scoped MCP capabilities. Includes schema, TypeScript types, DAG validation, exact permission derivation, MCP input/output contracts and a runnable example.

Source: `src/forge/spec.ts`, `src/forge/contracts.ts`; re-exported here without coupling to Next.js, AWS, or storage. Run `npm run spec:export` to export JSON Schema and a validated example. `npm test` exercises schema, cycle detection, input dependencies, permissions and runtime behavior.

The reference interpreter is `sandbox/worker.mjs`; the policy/runtime reference is `src/forge/broker.ts` and `src/forge/sandbox.ts`. Programs contain only allowlisted operations; no eval, shell, arbitrary imports, or network destinations. Each operation currently occurs at most once per DAG, preserving unambiguous data bindings.

This is an extraction boundary within the repository, not a published npm package. Independent package publication and a general data-binding system are future work. Contributions should preserve deny-by-default policy, digest-bound approval, and executable checks.

## Minimal usage

Run the supplied example from the repository root: `npx tsx packages/forgespec/examples/validate.ts`. It reads exported JSON relative to its own file and needs no server, AWS account or storage configuration.

```ts
import { readFile } from "node:fs/promises";
import {
  validateCapability,
  topologicalOrder,
  derivePermissions,
} from "./index";

const capability = validateCapability(
  JSON.parse(
    await readFile("packages/forgespec/examples/internship-scout.json", "utf8"),
  ),
);
console.log(topologicalOrder(capability).map((node) => node.operation));
console.log(derivePermissions(capability.nodes));
```

Validation rejects undeclared or extra permissions, unknown operations, cycles and invalid contracts. This example validates/describes a definition; it does not grant approval or install a tool. License: [MIT](../../LICENSE).
