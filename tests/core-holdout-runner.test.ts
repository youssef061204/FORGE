import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MemoryStateStore } from "../src/forge/store";
import {
  emptyProductState,
  type ConnectorDescriptor,
} from "../src/forge/product/contracts";
import {
  FixtureWorld,
  contains,
  equal,
  parseCsv,
  type HoldoutCase,
  type FixtureResource,
} from "../evaluation/core-holdout-runner/fixtures";
import {
  parseHoldoutOptions,
  selectHoldoutCases,
  verifyFreeze,
} from "../scripts/evaluate-core-holdout";

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    const absolute = resolve(directory),
      prefix = resolve(tmpdir(), "forge-holdout-runner-");
    if (!absolute.startsWith(prefix))
      throw new Error("Refusing cleanup outside the test directory");
    await rm(absolute, { recursive: true, force: true });
  }
});
function setup() {
  const descriptor: ConnectorDescriptor = {
    id: "records",
    name: "Generic controlled records",
    kind: "builtin",
    mode: "test",
    status: "connected",
    binding: "test",
    setup: "",
    constraints: { fixtureOnly: true },
    operations: [
      {
        id: "records.list",
        connector: "records",
        name: "List",
        description: "Read controlled records",
        inputSchema: { type: "object", additionalProperties: false },
        outputSchema: {
          type: "object",
          properties: { rows: { type: "array", items: { type: "object" } } },
          required: ["rows"],
        },
        permission: "records.read",
        kind: "read",
        sideEffect: "none",
        idempotent: true,
      },
      {
        id: "records.set",
        connector: "records",
        name: "Set",
        description: "Update one controlled value",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, value: { type: "number" } },
          required: ["id", "value"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        permission: "records.write",
        kind: "write",
        sideEffect: "reversible",
        idempotent: true,
      },
    ],
  };
  const resource: FixtureResource = {
    descriptor,
    collections: { rows: [{ id: "item", value: 1 }] },
    handlers: {
      "records.list": { kind: "list", collection: "rows", resultKey: "rows" },
      "records.set": {
        kind: "update",
        collection: "rows",
        selector: { field: "id", argument: "id" },
        fields: { value: "value" },
      },
    },
  };
  const mission: HoldoutCase = {
    id: "unit-only",
    family: "unit-only",
    request: "Generic handler unit test",
    now: "2026-01-01T00:00:00.000Z",
    evidenceClass: "synthetic-offline-fixture",
    resources: [resource],
    installedPrograms: [],
    conversation: [],
    missionInput: {},
    initialProgramState: {},
    schedulerTicks: [],
    repeatEvent: true,
  };
  const store = new MemoryStateStore(),
    world = new FixtureWorld(mission, store),
    fabric = world.fabric();
  const context = {
    key: "effect-key",
    mode: "live" as const,
    now: mission.now,
    observations: {},
  };
  return { mission, store, world, fabric, context };
}
describe("generic sealed-holdout fixture plumbing", () => {
  it("returns cloned reads, validates schemas, blocks replay writes, and deduplicates an effect key", async () => {
    const { world, fabric, context } = setup();
    await fabric.discover();
    const read = await fabric.invoke(
      "records.list",
      {},
      { ...context, mode: "replay" },
    );
    (read.data as { rows: { value: number }[] }).rows[0].value = 99;
    expect((await world.collections()).records.rows[0].value).toBe(1);
    await expect(
      fabric.invoke(
        "records.set",
        { id: "item", value: 2 },
        { ...context, mode: "replay" },
      ),
    ).rejects.toThrow("blocks replay writes");
    await expect(
      fabric.invoke("records.set", { id: "item", value: "invalid" }, context),
    ).rejects.toThrow("schema");
    await fabric.invoke("records.set", { id: "item", value: 2 }, context);
    await fabric.invoke("records.set", { id: "item", value: 2 }, context);
    expect((await world.collections()).records.rows).toEqual([
      { id: "item", value: 2 },
    ]);
    expect(world.writes).toHaveLength(1);
    expect(world.deduplicatedInvocations).toBe(1);
    await expect(
      fabric.preflight("records.set", { id: "absent", value: 3 }, context),
    ).rejects.toThrow("unique and present");
  });
  it("restores actual fixture collections and idempotency ledger from persisted bytes", async () => {
    const { mission, store, world, fabric, context } = setup();
    await store.transaction((state) => {
      state.product = emptyProductState();
    });
    await fabric.discover();
    await fabric.invoke("records.set", { id: "item", value: 4 }, context);
    const directory = await mkdtemp(join(tmpdir(), "forge-holdout-runner-"));
    temporary.push(directory);
    const file = join(directory, "fixtures.json");
    await world.save(file);
    const restored = await FixtureWorld.reload(mission, store, file),
      restoredFabric = restored.fabric();
    await restoredFabric.discover();
    await restoredFabric.invoke(
      "records.set",
      { id: "item", value: 4 },
      context,
    );
    expect(restored.writes).toHaveLength(1);
    expect((await restored.collections()).records.rows[0].value).toBe(4);
    restored.replace([
      {
        connector: "records",
        collection: "rows",
        value: [{ id: "item", value: 7 }],
      },
    ]);
    expect((await restored.collections()).records.rows[0].value).toBe(7);
  });
  it("compares JSON objects without losing array order or CSV quoting semantics", () => {
    expect(equal({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
    expect(equal([2, 3], [3, 2])).toBe(false);
    expect(
      contains({ id: "a", nested: { a: 1, b: 2 } }, { nested: { a: 1 } }),
    ).toBe(true);
    expect(parseCsv('id,label\r\n1,"a,b"\r\n2,"two ""quotes"""\r\n')).toEqual({
      columns: ["id", "label"],
      rows: [
        { id: "1", label: "a,b" },
        { id: "2", label: 'two "quotes"' },
      ],
    });
  });
  it("verifies appended state rather than trusting an acknowledgement ledger", async () => {
    const { mission, store, context } = setup();
    const resource = mission.resources[0];
    resource.descriptor.operations.push({
      ...resource.descriptor.operations[1],
      id: "records.append",
      inputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
    });
    resource.handlers["records.append"] = {
      kind: "append",
      collection: "rows",
      idField: "id",
      idPrefix: "item-",
    };
    const world = new FixtureWorld(mission, store),
      fabric = world.fabric();
    await fabric.discover();
    const args = { value: 8 },
      response = await fabric.invoke("records.append", args, context);
    const verification = {
      ...context,
      receipt: {
        connector: "records",
        operation: "records.append",
        target: response.target ?? "record",
        responseId: response.responseId,
        at: mission.now,
        status: "committed" as const,
        mode: "test" as const,
      },
    };
    expect(
      (await fabric.verify("records.append", args, verification)).status,
    ).toBe("verified");
    world.replace([{ connector: "records", collection: "rows", value: [] }]);
    expect(
      (await fabric.verify("records.append", args, verification)).status,
    ).toBe("failed");
    expect(world.writes).toHaveLength(1);
  });
  it("checks actual generic artifact bytes after the write", async () => {
    const { mission, store, context } = setup();
    const resource = mission.resources[0];
    resource.collections.artifacts = [];
    resource.descriptor.operations.push({
      ...resource.descriptor.operations[1],
      id: "records.artifact",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          format: { enum: ["json"] },
          text: { type: "string" },
        },
        required: ["name", "format", "text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          format: { type: "string" },
          bytes: { type: "number" },
        },
        required: ["id", "name", "format", "bytes"],
      },
    });
    resource.handlers["records.artifact"] = {
      kind: "artifact",
      collection: "artifacts",
    };
    const world = new FixtureWorld(mission, store),
      fabric = world.fabric();
    await fabric.discover();
    const args = { name: "result.json", format: "json", text: '{"a":1}' },
      response = await fabric.invoke("records.artifact", args, context);
    const verification = {
      ...context,
      receipt: {
        connector: "records",
        operation: "records.artifact",
        target: "result.json",
        responseId: response.responseId,
        at: mission.now,
        status: "committed" as const,
        mode: "test" as const,
      },
    };
    expect(
      (await fabric.verify("records.artifact", args, verification)).status,
    ).toBe("verified");
    const actual = (await world.collections()).records.artifacts;
    world.replace([
      {
        connector: "records",
        collection: "artifacts",
        value: [{ ...actual[0], text: '{"a":2}' }],
      },
    ]);
    expect(
      (await fabric.verify("records.artifact", args, verification)).status,
    ).toBe("failed");
  });
});

describe("holdout execution gates", () => {
  it("requires an explicit freeze and refuses cloud providers or partial recorded runs", () => {
    expect(() => parseHoldoutOptions([])).toThrow("required");
    expect(parseHoldoutOptions(["--help"])).toBeUndefined();
    expect(() =>
      parseHoldoutOptions(["--freeze=not-opened.json", "--provider=bedrock"]),
    ).toThrow("Only recorded or genuinely local");
    expect(() =>
      parseHoldoutOptions([
        "--freeze=not-opened.json",
        "--provider=recorded",
        "--limit=20",
      ]),
    ).toThrow("all 100");
  });
  it("rejects an invalid freeze before any sealed contents can be opened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-holdout-runner-"));
    temporary.push(directory);
    const file = join(directory, "invalid-freeze.json");
    await writeFile(
      file,
      JSON.stringify({
        frozenAt: "not-a-date",
        holdoutSealSha256: "wrong",
        sourceFiles: [],
      }),
    );
    await expect(verifyFreeze(file)).rejects.toThrow("Freeze timestamp");
  });
  it("chooses a stable family-balanced subset independent of input ordering or outcomes", () => {
    const base = setup().mission;
    const cases = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      id: "synthetic-unit-" + index,
      family: ["a", "b", "c"][index % 3],
    }));
    const selected = selectHoldoutCases(cases, 12);
    expect(selected.map((row) => row.id)).toEqual(
      selectHoldoutCases([...cases].reverse(), 12).map((row) => row.id),
    );
    expect(new Set(selected.map((row) => row.id)).size).toBe(12);
    for (const family of ["a", "b", "c"])
      expect(selected.filter((row) => row.family === family)).toHaveLength(4);
  });
});
