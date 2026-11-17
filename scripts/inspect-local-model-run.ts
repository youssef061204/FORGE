// Re-check captured genuine local model source without making any model requests.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { solutionSchema } from "../src/forge/product/contracts";
import type { PlanningContext } from "../src/forge/product/provider";
import { ConnectorFabric } from "../src/forge/product/fabric";
import {
  compileExecutable,
  runProgramExecutable,
} from "../src/forge/executable";
import { digest } from "../src/forge/hash";

const directory = resolve(process.argv[2] ?? "");
const evidenceRoot = resolve("artifacts/local-synthesis");
if (
  !directory.startsWith(evidenceRoot + "\\") &&
  !directory.startsWith(evidenceRoot + "/")
)
  throw new Error("Select a recorded run under artifacts/local-synthesis");
const chat = JSON.parse(await readFile(join(directory, "chat-1.json"), "utf8"));
const context = JSON.parse(chat.request.messages[1].content) as PlanningContext;
const fabric = new ConnectorFabric();
for (const descriptor of context.resources)
  fabric.register(descriptor.id, {
    describe: async () => descriptor,
    invoke: async () => {
      throw new Error("Recorded compiler metadata cannot invoke a connector");
    },
  });
await fabric.discover();
const diagnostics = [];
for (const name of (await readdir(directory)).filter((name) =>
  /^model-\d+\.json$/.test(name),
)) {
  try {
    const record = JSON.parse(await readFile(join(directory, name), "utf8"));
    const solution = solutionSchema.parse(record.solution);
    if (!solution.program) continue;
    fabric.validateDraft(solution.program);
    compileExecutable(
      solution.program.source,
      "program/v1",
      fabric.types(solution.program),
    );
    const tests = [];
    for (const test of solution.program.tests) {
      const actual = await runProgramExecutable(
        solution.program.source,
        test.input,
        fabric.types(solution.program),
      );
      tests.push({
        name: test.name,
        actual,
        expected: test.expectedOutput,
        exactOutputMatched: test.expectedOutput
          ? digest(actual) === digest(test.expectedOutput)
          : undefined,
        resultMatched: test.expectedOutput
          ? digest(actual.result) === digest(test.expectedOutput.result)
          : undefined,
        jsonFileContentsMatched: test.expectedOutput?.operations.map(
          (effect, index) => {
            const observed = actual.operations[index];
            if (
              effect.operation !== "workspace.save" ||
              effect.arguments.format !== "json" ||
              !observed
            )
              return undefined;
            return (
              digest(JSON.parse(String(effect.arguments.text))) ===
              digest(JSON.parse(String(observed.arguments.text)))
            );
          },
        ),
      });
    }
    diagnostics.push({ file: name, passed: true, tests });
  } catch (error) {
    diagnostics.push({
      file: name,
      passed: false,
      error: error instanceof Error ? error.message : "Compilation failed",
    });
  }
}
const report = {
  at: new Date().toISOString(),
  modelRequests: 0,
  paidRequests: 0,
  diagnostics,
};
await writeFile(
  join(directory, "compile-diagnostics.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
