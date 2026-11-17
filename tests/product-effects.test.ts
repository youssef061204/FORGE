import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../src/forge/store";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { ProductRuntime } from "../src/forge/product/runtime";
import { RecordedMissionModel } from "../src/forge/product/provider";
import { type ProgramDraft } from "../src/forge/product/contracts";
import {
  importWorkspaceDocument,
  WorkspaceConnector,
  workspaceEffectValue,
} from "../src/forge/product/workspace";

async function scenario(expectedText: string, expectedName = "double.json") {
  const store = new MemoryStateStore();
  const file = await importWorkspaceDocument(store, {
    name: "input.json",
    format: "json",
    text: '{"value":3}',
  });
  const fabric = new ConnectorFabric();
  fabric.register("workspace", new WorkspaceConnector(store));
  const program: ProgramDraft = {
    name: "Double a value",
    description: "Compute a new JSON value from the uploaded document",
    source: `function execute(input: ModuleInput): ModuleOutput {
      return {operations:[{operation:"workspace.save",arguments:{name:"double.json",format:"json",text:JSON.stringify({value:input.observations.file.data.value * 2},null,2)}}],result:{summary:"A human-readable message independent of test formatting"}};
    }`,
    reads: [{ operation: file.readOperation, arguments: {}, ref: "file" }],
    actions: ["workspace.save"],
    trigger: { kind: "manual" },
    tests: ["Normal calculation", "Zero boundary"].map((name, index) => ({
      name,
      input: {
        now: "2026-10-22T00:00:00.000Z",
        input: {},
        state: {},
        observations: {
          file: {
            id: file.id,
            name: "input.json",
            format: "json",
            data: { value: index === 0 ? 3 : 0 },
          },
        },
      },
      expectedOperations: ["workspace.save"],
      expectedEffects: [
        {
          operation: "workspace.save",
          arguments: {
            name: expectedName,
            format: "json",
            text: index === 0 ? expectedText : '{"value":0}',
          },
        },
      ],
    })),
  };
  const model = new RecordedMissionModel(() => ({
    route: "SYNTHESIZE",
    explanation: "Generate a pure transformation",
    existingIds: [],
    missingConnections: [],
    program,
  }));
  return { store, runtime: new ProductRuntime(store, fabric, model) };
}

describe("behavioral write assertions", () => {
  it("accepts equivalent JSON formatting without performing writes during admission", async () => {
    const { runtime, store } = await scenario('{"value":6}');
    const result = await runtime.ask(
      "Save the uploaded value multiplied by two",
    );
    expect(result.tool?.evidence.passed).toBe(true);
    expect((await store.read()).product!.workspace.artifacts).toEqual([]);
    expect(result.tool?.grants).toEqual([]);
  });
  it.each([
    ['{"value":7}', "double.json"],
    ['{"value":6}', "wrong-name.json"],
  ])(
    "rejects incorrect effect values or targets despite matching operation IDs",
    async (text, name) => {
      const { runtime, store } = await scenario(text, name);
      await expect(
        runtime.ask("Save the uploaded value multiplied by two"),
      ).rejects.toThrow(/expected write arguments/);
      expect((await store.read()).product!.workspace.artifacts).toEqual([]);
      expect((await store.read()).product!.programs).toEqual([]);
    },
  );
  it("compares CSV cells and order while preserving literal text semantics", () => {
    const args = { name: "table.csv", format: "csv" };
    expect(
      workspaceEffectValue({ ...args, text: 'name,value\r\n"A",2\r\n' }),
    ).toEqual(workspaceEffectValue({ ...args, text: "name,value\nA,2\n" }));
    expect(
      workspaceEffectValue({ ...args, text: "name,value\nA,2\nB,3\n" }),
    ).not.toEqual(
      workspaceEffectValue({ ...args, text: "name,value\nB,3\nA,2\n" }),
    );
    expect(
      workspaceEffectValue({ name: "note.txt", format: "text", text: "A\n" }),
    ).not.toEqual(
      workspaceEffectValue({ name: "note.txt", format: "text", text: "A" }),
    );
  });
});
