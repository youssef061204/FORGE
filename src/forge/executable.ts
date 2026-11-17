import ts from "typescript";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { moduleInputSchema, moduleOutputSchema } from "./live-contracts";
import { z } from "zod";
import { cityInputSchema, cityOutputSchema } from "./city-contracts";
import { digest } from "./hash";
import { programInputSchema, programOutputSchema } from "./product/contracts";

const types = `type ModuleInput = { email: { id: string; at: string; from: string; subject: string; body: string }; events: { id: string; title: string; date: string; etag?: string }[]; trustedSenders: string[] }; type ModuleOutput = { change: { eventId: string | null; title: string; date: string } | null; notify: boolean };`;
const compiledCache = new Map<string, string>();
export function algorithmHash(source: string) {
  const tree = ts.createSourceFile(
    "algorithm.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  function shape(node: ts.Node): unknown {
    if (ts.isPropertyAccessExpression(node))
      return ["property", shape(node.expression), node.name.text];
    if (ts.isIdentifier(node)) return "identifier";
    if (ts.isStringLiteral(node)) return "string-literal";
    if (ts.isNumericLiteral(node)) return "number-literal";
    if (
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword
    )
      return "boolean-literal";
    const children: unknown[] = [];
    node.forEachChild((child) => {
      children.push(shape(child));
    });
    return [ts.SyntaxKind[node.kind], ...children];
  }
  return digest(shape(tree));
}
export function schemaType(schema: Record<string, unknown>): string {
  if (schema.type === "integer") return "number";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union))
    return (
      "(" +
      union.map((s) => schemaType(s as Record<string, unknown>)).join(" | ") +
      ")"
    );
  if (Array.isArray(schema.type))
    return schema.type
      .map((type) => schemaType({ ...schema, type }))
      .join(" | ");
  if (schema.type === "array")
    return "Array<" + schemaType(schema.items as Record<string, unknown>) + ">";
  if (schema.type === "object") {
    const required = (schema.required ?? []) as string[];
    const fields = Object.entries(
      (schema.properties ?? {}) as Record<string, Record<string, unknown>>,
    ).map(([name, s]) => JSON.stringify(name) + (required.includes(name) ? "" : "?") + ": " + schemaType(s));
    if (schema.additionalProperties && !fields.length)
      return "Record<string, " + (typeof schema.additionalProperties === "object" ? schemaType(schema.additionalProperties as Record<string, unknown>) : "unknown") + ">";
    return (
      "{ " +
      fields.join("; ") +
      " }"
    );
  }
  return ["string", "number", "boolean", "null"].includes(String(schema.type))
    ? String(schema.type)
    : "unknown";
}
export function executableTypes(
  kind: "deadline/v1" | "city/v1" = "deadline/v1",
) {
  return kind === "deadline/v1"
    ? types
    : "type ModuleInput = " +
        schemaType(z.toJSONSchema(cityInputSchema) as Record<string, unknown>) +
        "; type ModuleOutput = " +
        schemaType(
          z.toJSONSchema(cityOutputSchema) as Record<string, unknown>,
        ) +
        ";";
}
export function compileExecutable(
  source: string,
  kind: "deadline/v1" | "city/v1" | "program/v1" = "deadline/v1",
  connectorTypes?: string,
): string {
  if (kind === "program/v1" && !connectorTypes) throw new Error("Connected program types are required");
  const key = kind + source + (connectorTypes ?? "");
  const cached = compiledCache.get(key);
  if (cached) return cached;
  if (source.length > 16000) throw new Error("Module source budget exceeded");
  const file = resolve("forge-generated.ts").replaceAll("\\", "/");
  const full =
    (kind === "program/v1" ? connectorTypes : executableTypes(kind)) +
    "\n" +
    source +
    "\nconst contract: (input: ModuleInput) => ModuleOutput = execute;";
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const originalSource = host.getSourceFile.bind(host);
  host.readFile = (name) => (name === file ? full : originalRead(name));
  host.fileExists = (name) => name === file || originalExists(name);
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    name === file
      ? ts.createSourceFile(name, full, ts.ScriptTarget.ES2022, true)
      : originalSource(
          name,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram([file], options, host);
  const tree = program.getSourceFile(file)!;
  const userTree = ts.createSourceFile(
    "module.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  if (
    userTree.statements.length !== 1 ||
    !ts.isFunctionDeclaration(userTree.statements[0]) ||
    userTree.statements[0].name?.text !== "execute"
  )
    throw new Error(
      "Module must contain exactly function execute(input: ModuleInput): ModuleOutput",
    );
  const entry = userTree.statements[0] as ts.FunctionDeclaration;
  if (
    entry.modifiers?.length ||
    entry.typeParameters?.length ||
    entry.parameters.length !== 1 ||
    entry.parameters[0].type?.getText(userTree) !== "ModuleInput" ||
    entry.type?.getText(userTree) !== "ModuleOutput"
  )
    throw new Error(
      "Executable interface must be a plain synchronous execute(input: ModuleInput): ModuleOutput",
    );
  let nodes = 0;
  function boundedSyntax(node: ts.Node, depth: number) {
    if (
      ++nodes > 4000 ||
      depth > 100 ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeParameterDeclaration(node)
    )
      throw new Error("Generated source syntax/type budget exceeded");
    node.forEachChild((child) => boundedSyntax(child, depth + 1));
  }
  boundedSyntax(userTree, 0);
  const forbidden = new Set([
    "process",
    "require",
    "global",
    "globalThis",
    "fetch",
    "eval",
    "Function",
    "constructor",
    "__proto__",
    "prototype",
    "WebAssembly",
    "import",
    "setTimeout",
  ]);
  function inspect(node: ts.Node) {
    if (
      (ts.isIdentifier(node) && forbidden.has(node.text)) ||
      ts.isImportDeclaration(node) ||
      node.kind === ts.SyntaxKind.ImportKeyword
    )
      throw new Error("Prohibited module access");
    node.forEachChild(inspect);
  }
  inspect(tree);
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length)
    throw new Error(
      `Generated module typecheck failed: ${ts.flattenDiagnosticMessageText(errors[0].messageText, " ")}`,
    );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  if (compiledCache.size >= 16)
    compiledCache.delete(compiledCache.keys().next().value!);
  compiledCache.set(key, compiled);
  return compiled;
}
async function runRawExecutable(
  source: string,
  raw: unknown,
  mode: "process" | "docker" = "process",
  kind: "deadline/v1" | "city/v1" | "program/v1" = "deadline/v1",
  connectorTypes?: string,
) {
  const input =
    kind === "program/v1"
      ? programInputSchema.parse(raw)
      : kind === "city/v1"
      ? cityInputSchema.parse(raw)
      : moduleInputSchema.parse(raw);
  const compiled = compileExecutable(source, kind, connectorTypes);
  const worker = resolve("sandbox/module-worker.mjs");
  const name = "forge-module-" + randomUUID();
  const args =
    mode === "docker"
      ? [
          "run",
          "--rm",
          "-i",
          "--name",
          name,
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=16",
          "--memory=96m",
          "--cpus=0.5",
          "forge-sandbox:local",
          "node",
          "--permission",
          "--allow-fs-read=/sandbox/module-worker.mjs",
          "--max-old-space-size=32",
          "--disable-proto=throw",
          "/sandbox/module-worker.mjs",
        ]
      : undefined;
  const child = spawn(
    mode === "docker" ? "docker" : process.execPath,
    args ?? [
      "--permission",
      `--allow-fs-read=${worker}`,
      "--max-old-space-size=32",
      "--disable-proto=throw",
      worker,
    ],
    {
      env: {
        NODE_ENV: "production",
        SystemRoot: process.env.SystemRoot,
        TZ: "UTC",
        ...(mode === "docker"
          ? { PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE }
          : {}),
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let result: string;
  try {
    result = await new Promise<string>((resolveResult, reject) => {
      let output = "";
      const timer = setTimeout(
        () => {
          child.kill();
          reject(new Error("Module wall-time exceeded"));
        },
        mode === "docker" ? 4000 : 1500,
      );
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 8192) {
          child.kill();
          reject(new Error("Module output budget exceeded"));
        }
      });
      child.stderr.resume();
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("Module process failed"));
        else resolveResult(output);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ source: compiled, input }) + "\n");
    });
  } finally {
    child.kill();
    if (mode === "docker")
      await new Promise<void>((done) => {
        const cleanup = spawn("docker", ["rm", "-f", name], {
          windowsHide: true,
          stdio: "ignore",
        });
        cleanup.on("error", () => done());
        cleanup.on("close", () => done());
      });
  }
  return JSON.parse(result) as unknown;
}
export async function runExecutable(
  source: string,
  raw: unknown,
  mode: "process" | "docker" = "process",
) {
  return moduleOutputSchema.parse(await runRawExecutable(source, raw, mode));
}
export async function runCityExecutable(
  source: string,
  raw: unknown,
  mode: "process" | "docker" = "process",
) {
  return cityOutputSchema.parse(
    await runRawExecutable(source, raw, mode, "city/v1"),
  );
}
export async function runProgramExecutable(
  source: string,
  input: unknown,
  connectorTypes: string,
  mode: "process" | "docker" = "process",
) {
  return programOutputSchema.parse(await runRawExecutable(source, input, mode, "program/v1", connectorTypes));
}
