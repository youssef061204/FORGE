import { createContext, Script } from "node:vm";
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.once("line", (line) => {
  try {
    const { source, input } = JSON.parse(line);
    // No host objects/functions enter the context. OS/process permission boundary is outside this VM.
    const context = createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    });
    const result = new Script(
      `"use strict"; ${source}\nJSON.stringify(execute(${JSON.stringify(input)}))`,
    ).runInContext(context, { timeout: 400 });
    if (typeof result !== "string" || result.length > 8192)
      throw new Error("Invalid module output");
    process.stdout.write(result + "\n");
  } catch {
    process.stdout.write(
      JSON.stringify({
        moduleError: "Generated module failed inside isolated process",
      }) + "\n",
    );
  }
  lines.close();
});
