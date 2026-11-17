import { digest } from "../hash";
import type { JsonSchema } from "./contracts";
import { parseForgeIR, IRCompileError, type ForgeIR } from "./schema";
import { analyzeIR, type IRCompileEnv } from "./typecheck";
import { emitIR, type IRSourceLocation } from "./emit";

export { forgeIRSchema, forgeIRJsonSchema, forgeIRGenerationSchema, IRCompileError, IR_LIMITS, parseForgeIR } from "./schema";
export type { ForgeIR, IRExpr, IRStep, IREffect, IRAggregate, IRDiagnostic, JsonValue } from "./schema";
export { evaluateIR } from "./evaluate";
export type { IRCompileEnv } from "./typecheck";
export type { IRSourceLocation } from "./emit";

/** 1.1 adds host-shared scalar extensions used by recipe lowering. */
export const IR_COMPILER_VERSION = "forge-ir/1.1.0";
export type IRCompilation = {
  ir: ForgeIR;
  source: string;
  sourceMap: Record<string, IRSourceLocation>;
  compilerVersion: string;
  irHash: string;
  sourceHash: string;
  inferredOutputSchemas: { operation: string; arguments: JsonSchema }[];
  helpers: string[];
  timings: { totalMs: number };
};

/**
 * Type-check an IR program and emit TypeScript. Pure: no model, connector,
 * filesystem or network access. Compiling the emitted TypeScript is a separate
 * server-side check (translation validation), so this runs in a browser too.
 */
export function compileIR(raw: unknown, env: IRCompileEnv): IRCompilation {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const ir = parseForgeIR(raw);
  const analysis = analyzeIR(ir, env);
  const emitted = emitIR(ir, analysis);
  if (emitted.source.length > 64000)
    throw new IRCompileError([{ stage: "budget", code: "SOURCE_BUDGET", path: "/", message: "Emitted source exceeds 64000 characters" }]);
  return {
    ir,
    ...emitted,
    compilerVersion: IR_COMPILER_VERSION,
    irHash: digest(ir),
    sourceHash: digest(emitted.source),
    inferredOutputSchemas: analysis.inferredOutputSchemas,
    timings: { totalMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - started },
  };
}
