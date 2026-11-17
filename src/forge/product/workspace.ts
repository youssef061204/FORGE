import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { digest } from "../hash";
import type { StateStore } from "../store";
import {
  emptyProductState,
  emptyWorkspace,
  workspaceFormatSchema,
  type CallContext,
  type FabricConnector,
  type JsonSchema,
  type WorkspaceState,
  type VerificationContext,
  type EffectVerification,
} from "./contracts";
import { objectSchema } from "./schemas";

const DOCUMENT_BYTES = 16384;
const OUTPUT_BYTES = 5000;
const payloadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (name) =>
          !/[\\/\u0000-\u001f:]/.test(name) && ![".", ".."].includes(name),
        "Use a file name without a directory or path",
      ),
    format: workspaceFormatSchema,
    text: z.string().max(DOCUMENT_BYTES),
  })
  .strict();
type Payload = z.infer<typeof payloadSchema>;
type File = WorkspaceState["documents"][number];

// CSV parsing is a trusted data primitive, never a goal-specific transformation.
// Quoted separators/newlines and escaped quotes are preserved as literal text.
function parseCsv(text: string) {
  const table: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  function cell() {
    if (field.length > 1000)
      throw new Error("CSV cells must be at most 1000 characters");
    row.push(field);
    if (row.length > 20)
      throw new Error("CSV files support at most 20 columns");
    field = "";
    closed = false;
  }
  function line() {
    cell();
    table.push(row);
    row = [];
    if (table.length > 201)
      throw new Error("CSV files support at most 200 data rows");
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (char === "\r" && text[i + 1] === "\n") {
        field += "\n";
        i++;
      } else field += char;
    } else if (char === ",") cell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"')
      throw new Error("CSV contains an invalid quoted field");
    else field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (row.length || field || closed || !table.length) line();
  const columns = table.shift()!;
  if (
    columns.some(
      (column) =>
        !column.trim() ||
        column.length > 80 ||
        ["__proto__", "prototype", "constructor"].includes(column),
    ) ||
    new Set(columns).size !== columns.length
  )
    throw new Error(
      "CSV headers must be distinct nonempty names of at most 80 characters",
    );
  if (table.some((values) => values.length !== columns.length))
    throw new Error(
      "CSV rows must have the same number of cells as the header",
    );
  return {
    columns,
    rows: table.map((values) =>
      Object.fromEntries(columns.map((column, i) => [column, values[i]])),
    ),
  };
}

function jsonSchema(
  value: unknown,
  budget = { nodes: 0 },
  depth = 0,
): JsonSchema {
  if (++budget.nodes > 500 || depth > 6)
    throw new Error("JSON document structure exceeds the workspace limit");
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    if (value.length > 200)
      throw new Error("JSON arrays support at most 200 items");
    const variants = [
      ...new Map(
        value.map((item) => {
          const schema = jsonSchema(item, budget, depth + 1);
          return [JSON.stringify(schema), schema] as const;
        }),
      ).values(),
    ];
    return {
      type: "array",
      maxItems: 200,
      items:
        variants.length === 0
          ? {}
          : variants.length === 1
            ? variants[0]
            : { anyOf: variants },
    };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (
      entries.length > 40 ||
      entries.some(([key]) =>
        ["__proto__", "prototype", "constructor"].includes(key),
      )
    )
      throw new Error("JSON objects support at most 40 ordinary properties");
    return objectSchema(
      Object.fromEntries(
        entries.map(([key, item]) => [
          key,
          jsonSchema(item, budget, depth + 1),
        ]),
      ),
      entries.map(([key]) => key),
    );
  }
  if (typeof value === "string")
    return { type: "string", maxLength: DOCUMENT_BYTES };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON numbers must be finite");
    return { type: "number" };
  }
  return { type: "boolean" };
}

function validated(raw: unknown, maximumBytes = DOCUMENT_BYTES) {
  const payload = payloadSchema.parse(raw);
  const bytes = Buffer.byteLength(payload.text, "utf8");
  if (bytes > maximumBytes)
    throw new Error(
      `Workspace content must be at most ${maximumBytes} UTF-8 bytes`,
    );
  // Validate the complete payload before saving anything.
  if (payload.format === "csv") parseCsv(payload.text);
  if (payload.format === "json") jsonSchema(JSON.parse(payload.text));
  return { payload, bytes };
}

// Test effects compare the declared file format's contents, while retaining the
// exact filename and format. This never changes generated source or saved bytes.
export function workspaceEffectValue(raw: unknown) {
  const { payload } = validated(raw, OUTPUT_BYTES);
  return {
    name: payload.name,
    format: payload.format,
    content:
      payload.format === "json"
        ? (JSON.parse(payload.text) as unknown)
        : payload.format === "csv"
          ? parseCsv(payload.text)
          : payload.text,
  };
}
function fileMetadata(file: File) {
  return {
    id: file.id,
    name: file.name,
    format: file.format,
    bytes: file.bytes,
    sha256: file.sha256,
    createdAt: file.createdAt,
  };
}
function assertIntegrity(file: File) {
  if (
    Buffer.byteLength(file.text, "utf8") !== file.bytes ||
    createHash("sha256").update(file.text, "utf8").digest("hex") !== file.sha256
  )
    throw new Error("Workspace file content failed its integrity check");
  if (
    file.id.startsWith("d") &&
    file.id !==
      "d" +
        digest({ name: file.name, format: file.format, text: file.text }).slice(
          0,
          24,
        )
  )
    throw new Error(
      "Workspace input identity changed; import it as a new file",
    );
}
function data(file: File) {
  assertIntegrity(file);
  const common = { id: file.id, name: file.name, format: file.format };
  if (file.format === "csv") return { ...common, ...parseCsv(file.text) };
  if (file.format === "json")
    return { ...common, data: JSON.parse(file.text) as unknown };
  return { ...common, text: file.text };
}
function outputSchema(file: File): JsonSchema {
  const fields: Record<string, unknown> = {
    id: { type: "string", const: file.id },
    name: { type: "string", maxLength: 80 },
    format: { type: "string", const: file.format },
  };
  if (file.format === "csv") {
    const { columns } = parseCsv(file.text);
    fields.columns = {
      type: "array",
      items: { type: "string", enum: columns },
      minItems: columns.length,
      maxItems: columns.length,
      uniqueItems: true,
    };
    fields.rows = {
      type: "array",
      maxItems: 200,
      items: objectSchema(
        Object.fromEntries(
          columns.map((column) => [
            column,
            { type: "string", maxLength: 1000 },
          ]),
        ),
        columns,
      ),
    };
  } else if (file.format === "json")
    fields.data = jsonSchema(JSON.parse(file.text));
  else fields.text = { type: "string", maxLength: DOCUMENT_BYTES };
  return objectSchema(fields, Object.keys(fields));
}
async function loadWorkspace(store: StateStore): Promise<WorkspaceState> {
  const existing = (await store.read()).product?.workspace;
  if (existing?.binding) return existing;
  return store.transaction((state) => {
    const workspace = ((state.product ??= emptyProductState()).workspace ??=
      emptyWorkspace());
    workspace.binding ||= randomUUID();
    return structuredClone(workspace);
  });
}

export function workspaceSummary(workspace: WorkspaceState | undefined) {
  return {
    documents: (workspace?.documents ?? []).map((document) => ({
      ...fileMetadata(document),
      readOperation: "workspace.read_" + document.id,
    })),
    artifacts: (workspace?.artifacts ?? []).map(fileMetadata),
    limits: {
      documents: 20,
      artifacts: 100,
      inputBytes: DOCUMENT_BYTES,
      outputBytes: OUTPUT_BYTES,
      csvRows: 200,
      csvColumns: 20,
    },
  };
}
export async function importWorkspaceDocument(store: StateStore, raw: Payload) {
  const { payload, bytes } = validated(raw);
  const sha256 = createHash("sha256")
    .update(payload.text, "utf8")
    .digest("hex");
  const id = "d" + digest(payload).slice(0, 24);
  await loadWorkspace(store);
  return store.transaction((state) => {
    const workspace = state.product!.workspace;
    const previous = workspace.documents.find((document) => document.id === id);
    if (previous)
      return {
        ...fileMetadata(previous),
        readOperation: "workspace.read_" + id,
      };
    if (
      workspace.documents.some(
        (document) =>
          document.name.toLowerCase() === payload.name.toLowerCase(),
      )
    )
      throw new Error(
        `A different input already uses the name ${payload.name}. Rename the new file before uploading it; installed tools remain bound to their original inputs.`,
      );
    if (workspace.documents.length >= 20)
      throw new Error("Workspace document capacity is full (20 files)");
    const document: File = {
      ...payload,
      id,
      bytes,
      sha256,
      createdAt: new Date().toISOString(),
    };
    workspace.documents.push(document);
    return { ...fileMetadata(document), readOperation: "workspace.read_" + id };
  });
}
export async function readWorkspaceArtifact(store: StateStore, id: string) {
  if (!/^a[0-9a-f]{24}$/.test(id)) throw new Error("Unknown workspace output");
  const artifact = (await store.read()).product?.workspace.artifacts.find(
    (file) => file.id === id,
  );
  if (!artifact) throw new Error("Unknown workspace output");
  assertIntegrity(artifact);
  return { ...fileMetadata(artifact), text: artifact.text };
}

export class WorkspaceConnector implements FabricConnector {
  constructor(private store: StateStore) {}
  async describe() {
    const workspace = await loadWorkspace(this.store);
    return {
      id: "workspace",
      name: "Local files",
      kind: "builtin" as const,
      status: "connected" as const,
      mode: "live" as const,
      binding: workspace.binding,
      setup: "/",
      constraints: {
        storage: "FORGE local state only",
        externalService: false,
        immutableInputs: true,
        arbitraryFilesystem: false,
        maxInputBytes: DOCUMENT_BYTES,
        maxOutputBytes: OUTPUT_BYTES,
        maxCsvRows: 200,
        maxCsvColumns: 20,
      },
      operations: [
        ...workspace.documents.map((file) => ({
          id: "workspace.read_" + file.id,
          connector: "workspace",
          name: "Read " + file.name,
          description: `Read the immutable owner-uploaded ${file.format} file ${file.name}. ${file.bytes} bytes. CSV values remain strings; generated software implements all transformations.`,
          inputSchema: objectSchema(),
          outputSchema: outputSchema(file),
          permission: "workspace." + file.id + ".read",
          kind: "read" as const,
          sideEffect: "none" as const,
          idempotent: true,
        })),
        {
          id: "workspace.save",
          connector: "workspace",
          name: "Save a downloadable local file",
          description: `Save a new downloadable output in FORGE. Arguments are name, format (csv/text/json), and text. No paths, overwrite or external upload. Maximum ${OUTPUT_BYTES} UTF-8 bytes.`,
          inputSchema: objectSchema(
            {
              name: { type: "string", minLength: 1, maxLength: 80 },
              format: { type: "string", enum: ["csv", "text", "json"] },
              text: { type: "string", maxLength: OUTPUT_BYTES },
            },
            ["name", "format", "text"],
          ),
          outputSchema: objectSchema(
            {
              id: { type: "string" },
              name: { type: "string" },
              format: { type: "string", enum: ["csv", "text", "json"] },
              bytes: { type: "integer", minimum: 0, maximum: OUTPUT_BYTES },
            },
            ["id", "name", "format", "bytes"],
          ),
          permission: "workspace.outputs.write",
          kind: "write" as const,
          sideEffect: "reversible" as const,
          idempotent: true,
        },
      ],
    };
  }
  async preflight(id: string, args: Record<string, unknown>) {
    if (id === "workspace.save") validated(args, OUTPUT_BYTES);
  }
  async verify(
    id: string,
    args: Record<string, unknown>,
    context: VerificationContext,
  ): Promise<EffectVerification> {
    if (id !== "workspace.save")
      return {
        status: "unverified",
        reason: "This workspace operation has no effect verification contract",
      };
    const { payload, bytes } = validated(args, OUTPUT_BYTES);
    // Read the persisted store after the write transaction has committed. Never
    // accept a callback's draft state or the connector acknowledgement as proof.
    const artifact = (
      await this.store.read()
    ).product?.workspace.artifacts.find(
      (file) =>
        file.id === context.receipt.responseId &&
        file.effectKey === digest(context.key),
    );
    if (!artifact)
      return {
        status: "failed",
        reason:
          "The acknowledged output artifact is absent from persisted storage",
      };
    try {
      assertIntegrity(artifact);
      if (
        artifact.name !== payload.name ||
        artifact.format !== payload.format ||
        artifact.text !== payload.text ||
        artifact.bytes !== bytes
      )
        throw new Error("Persisted artifact differs from requested content");
      return {
        status: "verified",
        reason:
          "Persisted artifact bytes, digest, name, format and content match the committed request",
        data: {
          name: artifact.name,
          format: artifact.format,
          text: artifact.text,
        },
      };
    } catch {
      return {
        status: "failed",
        reason:
          "The persisted output failed its content integrity verification",
      };
    }
  }
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    if (id.startsWith("workspace.read_")) {
      if (Object.keys(args).length)
        throw new Error("Workspace file reads take no arguments");
      const workspace = context.workspace ?? (await loadWorkspace(this.store));
      const file = workspace.documents.find(
        (document) => "workspace.read_" + document.id === id,
      );
      if (!file) throw new Error("Unknown owner-uploaded workspace file");
      return { data: data(file), target: file.name };
    }
    if (id !== "workspace.save") throw new Error("Unknown workspace operation");
    if (context.mode !== "live")
      throw new Error("Replay cannot save workspace outputs");
    const { payload, bytes } = validated(args, OUTPUT_BYTES);
    const effectKey = digest(context.key);
    const save = (workspace: WorkspaceState) => {
      const previous = workspace.artifacts.find(
        (artifact) => artifact.effectKey === effectKey,
      );
      if (previous) {
        if (
          previous.name !== payload.name ||
          previous.format !== payload.format ||
          previous.text !== payload.text
        )
          throw new Error(
            "An existing workspace effect key cannot save different content",
          );
        return previous;
      }
      if (workspace.artifacts.length >= 100)
        throw new Error("Workspace output capacity is full (100 files)");
      const file = {
        ...payload,
        id: "a" + effectKey.slice(0, 24),
        bytes,
        sha256: createHash("sha256").update(payload.text, "utf8").digest("hex"),
        createdAt: context.now,
        effectKey,
      };
      workspace.artifacts.push(file);
      return file;
    };
    const artifact = context.workspace
      ? save(context.workspace)
      : await this.store.transaction((state) =>
          save((state.product ??= emptyProductState()).workspace),
        );
    return {
      data: {
        id: artifact.id,
        name: artifact.name,
        format: artifact.format,
        bytes: artifact.bytes,
      },
      responseId: artifact.id,
      target: artifact.name,
    };
  }
}
