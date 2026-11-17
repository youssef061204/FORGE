import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { StateStore } from "../../src/forge/store";
import { ConnectorFabric } from "../../src/forge/product/fabric";
import { WorkspaceConnector } from "../../src/forge/product/workspace";
import { validateJson } from "../../src/forge/product/schemas";
import type {
  CallContext,
  ConnectorDescriptor,
  ConnectorResult,
  FabricConnector,
  ProgramDraft,
  Solution,
  VerificationContext,
  EffectVerification,
} from "../../src/forge/product/contracts";

export type JsonRecord = Record<string, unknown>;
export type FixtureHandler = {
  kind: "constant" | "list" | "artifact" | "append" | "update";
  value?: unknown;
  collection?: string;
  resultKey?: string;
  constants?: JsonRecord;
  result?: JsonRecord;
  idField?: string;
  idPrefix?: string;
  selector?: { argument: string; field: string };
  fields?: Record<string, string>;
};
export type FixtureResource = {
  descriptor: ConnectorDescriptor;
  collections: Record<string, JsonRecord[]>;
  handlers: Record<string, FixtureHandler>;
};
export type InstalledSeed = {
  id: string;
  version: string;
  status?: string;
  goal?: string;
  description: string;
  grants?: string[];
  bindings?: Record<string, string>;
  programState?: JsonRecord;
  draft: ProgramDraft;
};
export type HoldoutCase = {
  id: string;
  family: string;
  request: string;
  now: string;
  evidenceClass: "synthetic-offline-fixture";
  resources: FixtureResource[];
  installedPrograms: InstalledSeed[];
  conversation: { role: "user" | "forge"; text: string; toolId?: string }[];
  lastToolId?: string;
  missionInput: JsonRecord;
  initialProgramState: JsonRecord;
  schedulerTicks: {
    at: string;
    eventId: string;
    replace: { connector: string; collection: string; value: JsonRecord[] }[];
  }[];
  repeatEvent: boolean;
};
export type Oracle = {
  id: string;
  route: string;
  acceptableRoutes: string[];
  permissions: { mode: "exact"; values: string[] };
  generation: "allowed" | "forbidden";
  mustNotClaimLive: boolean;
  postconditions: JsonRecord[];
  sideEffectPolicy: {
    maxWrites: number;
    duplicateWrites: number;
    undeclaredOperations: number;
  };
  [key: string]: unknown;
};
export type Recording = { id: string; provenance: string; solution: Solution };
export type FixtureWrite = {
  key: string;
  operation: string;
  arguments: JsonRecord;
  response: ConnectorResult;
  at: string;
};
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const copy = <T>(value: T): T => structuredClone(value);
export function equal(a: unknown, b: unknown): boolean {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, ordered(v)]),
          )
        : value;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
export function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => contains(actual[i], v))
    );
  if (expected && typeof expected === "object")
    return (
      !!actual &&
      typeof actual === "object" &&
      Object.entries(expected).every(([k, v]) =>
        contains((actual as JsonRecord)[k], v),
      )
    );
  return equal(actual, expected);
}
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const columns = rows.shift() ?? [];
  return {
    columns,
    rows: rows.map((values) => {
      if (values.length !== columns.length)
        throw new Error("CSV width mismatch");
      return Object.fromEntries(values.map((v, i) => [columns[i], v]));
    }),
  };
}

type WorldSnapshot = {
  resources: FixtureResource[];
  writes: FixtureWrite[];
  readCalls: number;
  preflights: number;
  invocationAttempts: number;
  deduplicatedInvocations: number;
  replayWriteAttempts: number;
};
export class FixtureWorld {
  readonly resources: FixtureResource[];
  readonly writes: FixtureWrite[];
  readCalls = 0;
  preflights = 0;
  invocationAttempts = 0;
  deduplicatedInvocations = 0;
  replayWriteAttempts = 0;
  private readonly ledger = new Map<string, FixtureWrite>();
  constructor(
    readonly mission: HoldoutCase,
    readonly store: StateStore,
    snapshot?: WorldSnapshot,
  ) {
    this.resources = copy(snapshot?.resources ?? mission.resources);
    this.writes = copy(snapshot?.writes ?? []);
    for (const write of this.writes) this.ledger.set(write.key, write);
    if (snapshot) {
      this.readCalls = snapshot.readCalls;
      this.preflights = snapshot.preflights;
      this.invocationAttempts = snapshot.invocationAttempts;
      this.deduplicatedInvocations = snapshot.deduplicatedInvocations;
      this.replayWriteAttempts = snapshot.replayWriteAttempts;
    }
  }
  async seedWorkspace() {
    const fixture = this.resources.find((r) => r.descriptor.id === "workspace");
    if (!fixture) return;
    await this.store.transaction((state) => {
      if (!state.product)
        throw new Error("Initialize ProductRuntime before seeding fixtures");
      state.product.workspace = {
        binding: fixture.descriptor.binding,
        documents: copy(fixture.collections.documents ?? []) as never[],
        artifacts: [],
      };
    });
  }
  fabric(): ConnectorFabric {
    const fabric = new ConnectorFabric();
    for (const resource of this.resources)
      fabric.register(
        resource.descriptor.id,
        resource.descriptor.id === "workspace"
          ? this.workspaceConnector(resource)
          : this.connector(resource),
      );
    return fabric;
  }
  private workspaceConnector(resource: FixtureResource): FabricConnector {
    const workspace = new WorkspaceConnector(this.store);
    return {
      describe: async () => {
        const actual = await workspace.describe();
        return {
          ...actual,
          name: resource.descriptor.name,
          mode: "test",
          binding: resource.descriptor.binding,
          constraints: {
            ...actual.constraints,
            fixtureOnly: true,
            noNetwork: true,
          },
        };
      },
      preflight: (operation, args) => workspace.preflight(operation, args),
      verify: (operation, args, context) =>
        workspace.verify(operation, args, context),
      invoke: async (operation, args, context) => {
        if (operation !== "workspace.save") {
          this.readCalls++;
          return workspace.invoke(operation, args, context);
        }
        this.invocationAttempts++;
        if (context.mode !== "live") {
          this.replayWriteAttempts++;
          throw new Error("Evaluation fixture blocks replay writes");
        }
        const existing = this.ledger.get(context.key);
        if (existing) {
          this.deduplicatedInvocations++;
          return copy(existing.response);
        }
        const response = await workspace.invoke(operation, args, context);
        this.record(operation, args, context, response);
        return response;
      },
    };
  }
  private connector(resource: FixtureResource): FabricConnector {
    const descriptor = copy(resource.descriptor);
    // A test-fixture owner authorizes editing its synthetic dedicated calendar.
    // This changes no live consent or permissions and never consults the oracle.
    if (descriptor.id === "calendar")
      descriptor.constraints.calendarWritesConsented =
        descriptor.operations.some((o) => o.kind === "write");
    const find = (operation: string) => {
      const definition = descriptor.operations.find((o) => o.id === operation);
      const handler = resource.handlers[operation];
      if (!definition || !handler) throw new Error("Unknown fixture operation");
      if (descriptor.status !== "connected")
        throw new Error("Fixture connection is unavailable");
      return { definition, handler };
    };
    const preflight = async (operation: string, args: JsonRecord) => {
      this.preflights++;
      const { definition, handler } = find(operation);
      validateJson(definition.inputSchema, args, "Fixture arguments");
      if (handler.kind === "update") this.target(resource, handler, args);
    };
    return {
      describe: async () => copy(descriptor),
      preflight,
      verify: async (
        operation: string,
        args: JsonRecord,
        context: VerificationContext,
      ): Promise<EffectVerification> => {
        const write = this.ledger.get(context.key);
        if (
          !write ||
          write.operation !== operation ||
          !equal(write.arguments, args)
        )
          return {
            status: "failed",
            reason: "Fixture committed effect is absent or differs",
          };
        const { handler } = find(operation);
        if (handler.kind === "update") {
          const row = this.target(resource, handler, args);
          const desired = Object.fromEntries(
            Object.entries(handler.fields ?? {}).map(([field, argument]) => [
              field,
              args[argument],
            ]),
          );
          return {
            status: contains(row, desired) ? "verified" : "failed",
            reason: "Read synthetic committed target state",
            data: copy(row),
          };
        }
        const rows = resource.collections[handler.collection ?? ""];
        if (!rows)
          return {
            status: "failed",
            reason: "Synthetic committed collection is absent",
          };
        if (handler.kind === "append") {
          const idField = handler.idField ?? "id",
            id = write.response.responseId;
          const matches = rows.filter((row) => row[idField] === id);
          const expected = {
            ...copy(args),
            ...copy(handler.constants ?? {}),
            [idField]: id,
          };
          return {
            status:
              matches.length === 1 && equal(matches[0], expected)
                ? "verified"
                : "failed",
            reason: "Read synthetic appended collection state",
            ...(matches.length === 1 ? { data: copy(matches[0]) } : {}),
          };
        }
        if (handler.kind === "artifact") {
          const matches = rows.filter(
            (row) => row.id === write.response.responseId,
          );
          const text = String(args.text);
          const matched =
            matches.length === 1 &&
            matches[0].name === args.name &&
            matches[0].format === args.format &&
            matches[0].text === text &&
            matches[0].bytes === Buffer.byteLength(text) &&
            matches[0].sha256 === sha256(text);
          return {
            status: matched ? "verified" : "failed",
            reason: "Read synthetic artifact bytes and identity",
            ...(matches.length === 1 ? { data: copy(matches[0]) } : {}),
          };
        }
        return {
          status: "unverified",
          reason: "Fixture handler has no committed-state verifier",
        };
      },
      invoke: async (operation, args, context) => {
        const { definition, handler } = find(operation);
        validateJson(definition.inputSchema, args, "Fixture arguments");
        if (definition.kind === "read") {
          this.readCalls++;
          if (handler.kind === "constant") return { data: copy(handler.value) };
          if (
            handler.kind !== "list" ||
            !handler.collection ||
            !handler.resultKey
          )
            throw new Error("Invalid fixture read handler");
          return {
            data: {
              [handler.resultKey]: copy(
                resource.collections[handler.collection],
              ),
              ...copy(handler.constants ?? {}),
            },
          };
        }
        this.invocationAttempts++;
        if (context.mode !== "live") {
          this.replayWriteAttempts++;
          throw new Error("Evaluation fixture blocks replay writes");
        }
        const previous = this.ledger.get(context.key);
        if (previous) {
          this.deduplicatedInvocations++;
          return copy(previous.response);
        }
        await preflight(operation, args);
        const collection = resource.collections[handler.collection ?? ""];
        if (!collection) throw new Error("Unknown fixture collection");
        let response: ConnectorResult;
        if (handler.kind === "append") {
          const idField = handler.idField ?? "id",
            id =
              (handler.idPrefix ?? "fixture-") +
              sha256(context.key).slice(0, 16);
          const row = {
            ...copy(args),
            ...copy(handler.constants ?? {}),
            [idField]: id,
          };
          collection.push(row);
          response = {
            data: copy(handler.result ?? { id }),
            responseId: id,
            target: String(id),
          };
        } else if (handler.kind === "update") {
          const row = this.target(resource, handler, args);
          for (const [field, argument] of Object.entries(handler.fields ?? {}))
            row[field] = copy(args[argument]);
          const id = String(row[handler.selector!.field]);
          response = { data: { id }, responseId: id, target: id };
        } else if (handler.kind === "artifact") {
          const id = "a" + sha256(context.key).slice(0, 24),
            text = String(args.text);
          collection.push({
            ...copy(args),
            id,
            bytes: Buffer.byteLength(text),
            sha256: sha256(text),
          });
          response = {
            data: {
              id,
              name: args.name,
              format: args.format,
              bytes: Buffer.byteLength(text),
            },
            responseId: id,
            target: String(args.name),
          };
        } else
          throw new Error("A fixture write requires a generic write handler");
        this.record(operation, args, context, response);
        return response;
      },
    };
  }
  private target(
    resource: FixtureResource,
    handler: FixtureHandler,
    args: JsonRecord,
  ): JsonRecord {
    if (!handler.selector || !handler.collection)
      throw new Error("Invalid fixture update selector");
    const matches = resource.collections[handler.collection].filter(
      (row) =>
        row[handler.selector!.field] === args[handler.selector!.argument],
    );
    if (matches.length !== 1)
      throw new Error("Fixture update target must be unique and present");
    return matches[0];
  }
  private record(
    operation: string,
    args: JsonRecord,
    context: CallContext,
    response: ConnectorResult,
  ) {
    const write = {
      key: context.key,
      operation,
      arguments: copy(args),
      response: copy(response),
      at: context.now,
    };
    this.writes.push(write);
    this.ledger.set(context.key, write);
  }
  replace(mutations: HoldoutCase["schedulerTicks"][number]["replace"]) {
    for (const mutation of mutations) {
      const resource = this.resources.find(
        (r) => r.descriptor.id === mutation.connector,
      );
      if (!resource || !(mutation.collection in resource.collections))
        throw new Error(
          "Scheduler fixture mutation references unknown collection",
        );
      resource.collections[mutation.collection] = copy(mutation.value);
    }
  }
  async collections() {
    const all = Object.fromEntries(
      this.resources.map((r) => [r.descriptor.id, copy(r.collections)]),
    );
    if (all.workspace) {
      const workspace = (await this.store.read()).product?.workspace;
      all.workspace = {
        documents: copy(workspace?.documents ?? []) as never[],
        artifacts: copy(workspace?.artifacts ?? []) as never[],
      };
    }
    return all;
  }
  async save(file: string) {
    await writeFile(
      file,
      JSON.stringify(
        {
          resources: this.resources,
          writes: this.writes,
          readCalls: this.readCalls,
          preflights: this.preflights,
          invocationAttempts: this.invocationAttempts,
          deduplicatedInvocations: this.deduplicatedInvocations,
          replayWriteAttempts: this.replayWriteAttempts,
        },
        null,
        2,
      ),
    );
  }
  static async reload(mission: HoldoutCase, store: StateStore, file: string) {
    return new FixtureWorld(
      mission,
      store,
      JSON.parse(await readFile(file, "utf8")) as WorldSnapshot,
    );
  }
}

export type PredicateResult = {
  kind: string;
  passed: boolean;
  details: string;
  semanticHeuristic?: boolean;
};
export type EvaluationEvidence = {
  mission: HoldoutCase;
  oracle: Oracle;
  result?: {
    state: string;
    route?: string;
    explanation: string;
    missingConnections?: string[];
  };
  tool?: import("../../src/forge/product/contracts").Program;
  baselinePrograms: import("../../src/forge/product/contracts").Program[];
  finalProduct: import("../../src/forge/product/contracts").ProductState;
  baselineCollections: Record<string, Record<string, JsonRecord[]>>;
  finalCollections: Record<string, Record<string, JsonRecord[]>>;
  writes: FixtureWrite[];
  reloaded: boolean;
};
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(
      (w) =>
        w.length > 2 &&
        !new Set([
          "the",
          "and",
          "for",
          "with",
          "which",
          "what",
          "this",
          "that",
          "from",
          "user",
          "please",
          "specify",
          "missing",
          "operation",
          "service",
        ]).has(w),
    );
function conceptMatch(expected: string, actual: string) {
  const groups = [
    "music playback spotify media",
    "mail email gmail inbox",
    "calendar event meeting appointment interview",
    "phone sms text message",
    "file upload document filesystem path",
    "chat slack teams channel",
    "printer print printing",
    "learning portal lms course",
    "zone timezone time morning evening duration window",
    "format filename output csv json text",
    "notifier tool installed",
    "threshold metric value interval",
  ];
  const a = new Set(words(actual));
  return words(expected).some(
    (word) =>
      a.has(word) ||
      groups.some(
        (group) =>
          group.split(" ").includes(word) &&
          group.split(" ").some((synonym) => a.has(synonym)),
      ),
  );
}
export function evaluatePredicates(e: EvaluationEvidence): PredicateResult[] {
  const result = e.result,
    product = e.finalProduct,
    tool = e.tool;
  return e.oracle.postconditions.map((condition) => {
    const kind = String(condition.kind);
    let passed = false;
    let details = "Condition not satisfied";
    let semanticHeuristic = false;
    const collection =
      e.finalCollections[String(condition.connector)]?.[
        String(condition.collection)
      ] ?? [];
    if (kind === "artifactEquals") {
      const artifacts = e.finalCollections.workspace?.artifacts ?? [];
      passed = artifacts.some((file) => {
        if (file.name !== condition.name || file.format !== condition.format)
          return false;
        try {
          const actual =
            file.format === "json"
              ? JSON.parse(String(file.text))
              : file.format === "csv"
                ? parseCsv(String(file.text))
                : file.text;
          const desired =
            file.format === "csv" && typeof condition.value === "string"
              ? parseCsv(condition.value)
              : condition.value;
          return equal(actual, desired);
        } catch {
          return false;
        }
      });
    } else if (kind === "collectionContains")
      passed = collection.some((row) => contains(row, condition.value));
    else if (kind === "collectionCount")
      passed = collection.length === condition.count;
    else if (kind === "collectionUnchanged")
      passed = equal(
        collection,
        e.baselineCollections[String(condition.connector)]?.[
          String(condition.collection)
        ] ?? [],
      );
    else if (kind === "notificationContains")
      passed = e.writes
        .filter((w) => w.operation === "notification.emit")
        .some((w) =>
          String(w.arguments.message).includes(String(condition.text)),
        );
    else if (kind === "programPersisted")
      passed =
        e.reloaded &&
        !!tool &&
        product.programs.some(
          (p) =>
            p.id === tool.id &&
            p.hash === tool.hash &&
            p.status === condition.status &&
            equal(p.trigger, condition.trigger),
        );
    else if (kind === "programStateContains")
      passed =
        !!tool &&
        contains(
          product.programs.find((p) => p.hash === tool.hash)?.programState,
          condition.value,
        );
    else if (kind === "existingProgramsUsed") {
      const ids = condition.ids as string[];
      passed =
        !!tool &&
        ids.every((id) =>
          result?.route === "REUSE"
            ? tool.id === id &&
              e.baselinePrograms.some(
                (p) => p.id === id && p.hash === tool.hash,
              )
            : result?.route === "EXTEND"
              ? tool.id === id &&
                e.baselinePrograms.some(
                  (p) => p.id === id && p.hash === tool.parentHash,
                )
              : tool.provenance.some((p) => p.id === id),
        );
    } else if (kind === "extensionLineage")
      passed =
        !!tool &&
        tool.id === condition.parentId &&
        e.baselinePrograms.some(
          (p) =>
            p.id === condition.parentId &&
            p.hash === tool.parentHash &&
            product.programs.some((old) => old.hash === p.hash),
        );
    else if (kind === "connectionRequest") {
      semanticHeuristic = true;
      passed =
        result?.state === "connect" &&
        (condition.resources as string[]).every((target) =>
          conceptMatch(
            target,
            [...(result.missingConnections ?? []), result.explanation].join(
              " ",
            ),
          ),
        );
    } else if (kind === "clarificationQuestion") {
      semanticHeuristic = true;
      passed =
        result?.state === "clarify" &&
        result.explanation.trim().length >= 12 &&
        conceptMatch(String(condition.topic), result.explanation);
    } else if (kind === "unsupportedExplanation") {
      semanticHeuristic = true;
      passed =
        !!result &&
        ["unsupported", "connect", "clarify"].includes(result.state) &&
        result.explanation.trim().length >= 20 &&
        /unsupported|cannot|can.t|unable|impossible|not (?:possible|supported)|unavailable/i.test(
          result.explanation,
        );
    } else if (kind === "noProgramCreated")
      passed =
        product.programs.length === e.baselinePrograms.length &&
        product.programs.every((p) =>
          e.baselinePrograms.some((old) => old.hash === p.hash),
        );
    else if (kind === "noWrites") passed = e.writes.length === 0;
    else details = "Unknown predicate; evaluator refuses to award success";
    if (passed) details = "Satisfied by captured product/fixture evidence";
    return {
      kind,
      passed,
      details,
      ...(semanticHeuristic ? { semanticHeuristic } : {}),
    };
  });
}
