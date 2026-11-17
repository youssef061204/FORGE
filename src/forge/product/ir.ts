import { compileExecutable, schemaType } from "../executable";
import { digest } from "../hash";
import type { JsonSchema } from "./contracts";
import { parseForgeIR, IRCompileError, type ForgeIR } from "./ir-schema";
import { analyzeIR, type IRCompileEnv } from "./ir-typecheck";
import { emitIR, type IRSourceLocation } from "./ir-emit";

export {
  forgeIRSchema,
  forgeIRJsonSchema,
  forgeIRGenerationSchema,
  IRCompileError,
  IR_LIMITS,
} from "./ir-schema";
export type {
  ForgeIR,
  IRExpr,
  IRStep,
  IREffect,
  IRAggregate,
  IRDiagnostic,
  JsonValue,
} from "./ir-schema";
export { evaluateIR } from "./ir-evaluate";
export type { IRCompileEnv } from "./ir-typecheck";
export type { IRSourceLocation } from "./ir-emit";

export const IR_COMPILER_VERSION = "forge-ir/1.0.0";
export type IRCompilation = {
  ir: ForgeIR;
  source: string;
  sourceMap: Record<string, IRSourceLocation>;
  compilerVersion: string;
  irHash: string;
  sourceHash: string;
  inferredOutputSchemas: { operation: string; arguments: JsonSchema }[];
  helpers: string[];
  diagnostics: [];
  timings: { loweringMs: number; compileMs: number; totalMs: number };
};

/** Lower an explicitly structured program. This function performs no model,
 * connector, credential, filesystem-write or network operation. */
export function compileIR(raw: unknown, env: IRCompileEnv): IRCompilation {
  const started = performance.now();
  const ir = parseForgeIR(raw);
  const analysis = analyzeIR(ir, env);
  const emitted = emitIR(ir, analysis);
  if (emitted.source.length > 16000)
    throw new IRCompileError([
      {
        stage: "budget",
        code: "SOURCE_BUDGET",
        path: "/",
        message:
          "Compiled IR exceeds the existing 16000-character executable budget",
      },
    ]);
  const operations = new Map(
    env.operations.map((operation) => [operation.id, operation]),
  );
  const union =
    env.actions
      .map(
        (id) =>
          `{operation:${JSON.stringify(id)};arguments:${schemaType(operations.get(id)!.inputSchema)}}`,
      )
      .join("|") || "never";
  const types = `type ModuleInput=${schemaType(analysis.roots.get("input")!)};type ModuleOutput={operations:Array<${union}>;result:{summary:string;details?:string[]};state?:Record<string,unknown>};`;
  const loweredAt = performance.now();
  try {
    compileExecutable(
      emitted.source,
      "program/v1",
      env.connectorTypes ?? types,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The generated executable failed the existing compiler";
    throw new IRCompileError([
      {
        stage: /budget/i.test(message) ? "budget" : "emit",
        code: /budget/i.test(message) ? "AST_BUDGET" : "EMITTED_SOURCE_INVALID",
        path: "/",
        message,
      },
    ]);
  }
  return {
    ir,
    ...emitted,
    compilerVersion: IR_COMPILER_VERSION,
    irHash: digest(ir),
    sourceHash: digest(emitted.source),
    inferredOutputSchemas: analysis.inferredOutputSchemas,
    diagnostics: [],
    timings: {
      loweringMs: loweredAt - started,
      compileMs: performance.now() - loweredAt,
      totalMs: performance.now() - started,
    },
  };
}
