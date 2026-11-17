import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../src/forge/store";
import {
  compileExecutable,
  runProgramExecutable,
} from "../src/forge/executable";
import { ConnectorFabric } from "../src/forge/product/fabric";
import {
  emptyProductState,
  productStateSchema,
  type CallContext,
} from "../src/forge/product/contracts";
import { validateJson } from "../src/forge/product/schemas";
import {
  WorkspaceConnector,
  importWorkspaceDocument,
  readWorkspaceArtifact,
  workspaceSummary,
} from "../src/forge/product/workspace";

const context = (key = "event-a"): CallContext => ({
  key,
  mode: "live",
  now: "2026-10-21T16:00:00.000Z",
  observations: {},
});
async function harness() {
  const store = new MemoryStateStore();
  const connector = new WorkspaceConnector(store);
  const fabric = new ConnectorFabric();
  fabric.register("workspace", connector);
  return { store, connector, fabric };
}
describe("bounded local workspace", () => {
  it("persists valid empty text files while rejecting empty structured files", async () => {
    const { store, fabric } = await harness();
    const file = await importWorkspaceDocument(store, {
      name: "empty.txt",
      format: "text",
      text: "",
    });
    await fabric.discover();
    expect(
      (await fabric.invoke(file.readOperation, {}, context())).data,
    ).toMatchObject({ text: "" });
    const saved = await fabric.invoke(
      "workspace.save",
      { name: "empty-output.txt", format: "text", text: "" },
      context(),
    );
    const artifact = await readWorkspaceArtifact(store, saved.responseId!);
    expect(artifact.text).toBe("");
    expect(artifact.bytes).toBe(0);
    expect(artifact.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    for (const format of ["csv", "json"] as const)
      await expect(
        fabric.invoke(
          "workspace.save",
          { name: "empty." + format, format, text: "" },
          context(format),
        ),
      ).rejects.toThrow();
    const product = (await store.read()).product!;
    expect(productStateSchema.parse(product).workspace.artifacts).toHaveLength(
      1,
    );
  });
  it("parses quoted CSV, escaped quotes and CRLF while preserving literal values", async () => {
    const { store, fabric } = await harness();
    const file = await importWorkspaceDocument(store, {
      name: "expenses.csv",
      format: "csv",
      text: 'name,amount,note\r\n"Smith, Jane",12.50,"said ""yes"""\r\nSam,7,"two\r\nlines"\r\n=SUM(A1),0,literal\r\n',
    });
    await fabric.discover();
    const response = await fabric.invoke(file.readOperation, {}, context());
    expect(response.data).toEqual({
      id: file.id,
      name: "expenses.csv",
      format: "csv",
      columns: ["name", "amount", "note"],
      rows: [
        { name: "Smith, Jane", amount: "12.50", note: 'said "yes"' },
        { name: "Sam", amount: "7", note: "two\nlines" },
        { name: "=SUM(A1)", amount: "0", note: "literal" },
      ],
    });
    expect(fabric.operation(file.readOperation).permission).toBe(
      "workspace." + file.id + ".read",
    );
    expect(
      JSON.stringify(workspaceSummary((await store.read()).product!.workspace)),
    ).not.toContain("Smith");
  });
  it("creates exact typed JSON read schemas without exposing raw text in summaries", async () => {
    const { store, fabric } = await harness();
    const file = await importWorkspaceDocument(store, {
      name: "data.json",
      format: "json",
      text: '{"active":true,"items":[{"name":"A","cost":3},{"name":"B","cost":4}],"note":null}',
    });
    await fabric.discover();
    const response = await fabric.invoke(file.readOperation, {}, context());
    expect(response.data).toMatchObject({
      data: {
        active: true,
        items: [
          { name: "A", cost: 3 },
          { name: "B", cost: 4 },
        ],
        note: null,
      },
    });
    const schema = fabric.operation(file.readOperation).outputSchema;
    expect(() =>
      validateJson(
        schema,
        {
          ...(response.data as object),
          data: { active: "true", items: [], note: null },
        },
        "read",
      ),
    ).toThrow(/schema/);
    expect(
      workspaceSummary((await store.read()).product!.workspace).documents[0],
    ).not.toHaveProperty("text");
  });
  it("gives each immutable file its own operation and deduplicates identical imports", async () => {
    const { store, connector } = await harness();
    const first = await importWorkspaceDocument(store, {
      name: "notes.txt",
      format: "text",
      text: "Private notes",
    });
    const duplicate = await importWorkspaceDocument(store, {
      name: "notes.txt",
      format: "text",
      text: "Private notes",
    });
    const other = await importWorkspaceDocument(store, {
      name: "notes-v2.txt",
      format: "text",
      text: "Changed notes",
    });
    expect(first.id).toBe(duplicate.id);
    expect(first.id).not.toBe(other.id);
    const description = await connector.describe();
    expect(
      description.operations.filter((operation) => operation.kind === "read"),
    ).toHaveLength(2);
    expect(description.binding).toBe(
      (await new WorkspaceConnector(store).describe()).binding,
    );
    expect(description.binding).not.toBe(
      (await new WorkspaceConnector(new MemoryStateStore()).describe()).binding,
    );
  });
  it("rejects changed inputs with an existing filename instead of making reuse ambiguous", async () => {
    const { store, fabric } = await harness();
    const original = {
      name: "orders.csv",
      format: "csv" as const,
      text: "product,total\nNotebook,15\n",
    };
    const first = await importWorkspaceDocument(store, original);
    expect(await importWorkspaceDocument(store, original)).toEqual(first);
    for (const name of ["orders.csv", "Orders.csv"]) {
      await expect(
        importWorkspaceDocument(store, {
          ...original,
          name,
          text: "product,total\nNotebook,99\n",
        }),
      ).rejects.toThrow(/Rename the new file before uploading/);
    }
    expect((await store.read()).product!.workspace.documents).toHaveLength(1);
    await fabric.discover();
    const response = await fabric.invoke(first.readOperation, {}, context());
    expect(response.data).toMatchObject({
      rows: [{ product: "Notebook", total: "15" }],
    });
  });
  it("stores actual downloadable output and exactly deduplicates the same effect", async () => {
    const { store, fabric } = await harness();
    await fabric.discover();
    const payload = {
      name: "total.csv",
      format: "csv",
      text: "category,total\nFood,19.50\n",
    };
    await fabric.preflight("workspace.save", payload, context());
    const first = await fabric.invoke("workspace.save", payload, context());
    const second = await fabric.invoke("workspace.save", payload, context());
    expect(second).toEqual(first);
    const id = (first.data as { id: string }).id;
    expect((await readWorkspaceArtifact(store, id)).text).toBe(payload.text);
    expect((await store.read()).product!.workspace.artifacts).toHaveLength(1);
    await expect(
      fabric.invoke(
        "workspace.save",
        { ...payload, text: "category,total\nFood,1\n" },
        context(),
      ),
    ).rejects.toThrow(/different content/);
  });
  it("blocks replay writes, arbitrary paths and malformed output before saving", async () => {
    const { store, connector } = await harness();
    await connector.describe();
    const output = {
      name: "output.txt",
      format: "text",
      text: "Actual result",
    };
    await expect(
      connector.invoke("workspace.save", output, {
        ...context(),
        mode: "replay",
      }),
    ).rejects.toThrow(/Replay/);
    for (const name of [
      "../output.txt",
      "folder\\output.txt",
      "C:output.txt",
      "..",
      "bad\nfile",
    ])
      await expect(
        connector.preflight("workspace.save", { ...output, name }),
      ).rejects.toThrow();
    await expect(
      connector.preflight("workspace.save", {
        ...output,
        text: "é".repeat(2501),
      }),
    ).rejects.toThrow(/5000/);
    await expect(
      connector.preflight("workspace.save", {
        ...output,
        format: "csv",
        text: 'name\n"unterminated',
      }),
    ).rejects.toThrow(/unterminated/);
    expect((await store.read()).product!.workspace.artifacts).toHaveLength(0);
  });
  it("rejects malformed CSV headers, inconsistent rows, bad quoting and structural bounds", async () => {
    const { store } = await harness();
    for (const text of [
      "a,a\n1,2",
      "a,b\n1",
      'a\n"x"junk',
      'a\nx"y',
      "__proto__\na",
      Array.from({ length: 21 }, (_, i) => "column" + i).join(","),
      "a\n" + Array(201).fill("1").join("\n"),
      "a\n" + "x".repeat(1001),
    ])
      await expect(
        importWorkspaceDocument(store, {
          name: "bad.csv",
          format: "csv",
          text,
        }),
      ).rejects.toThrow();
    expect(
      (await store.read()).product?.workspace.documents ?? [],
    ).toHaveLength(0);
  });
  it("bounds JSON nesting, invalid JSON, byte budgets and unknown operations", async () => {
    const { store, connector } = await harness();
    for (const text of [
      "{bad",
      JSON.stringify({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }),
      JSON.stringify(Array(201).fill(0)),
    ])
      await expect(
        importWorkspaceDocument(store, {
          name: "bad.json",
          format: "json",
          text,
        }),
      ).rejects.toThrow();
    await expect(
      importWorkspaceDocument(store, {
        name: "large.txt",
        format: "text",
        text: "é".repeat(8193),
      }),
    ).rejects.toThrow(/16384/);
    await expect(
      connector.invoke("workspace.read_unknown", {}, context()),
    ).rejects.toThrow(/Unknown/);
    await expect(
      connector.invoke("workspace.delete", {}, context()),
    ).rejects.toThrow(/Unknown/);
    await expect(readWorkspaceArtifact(store, "../private")).rejects.toThrow(
      /Unknown/,
    );
  });
  it("uses the host transaction workspace without nested store operations", async () => {
    const { store, connector } = await harness();
    const document = await importWorkspaceDocument(store, {
      name: "source.txt",
      format: "text",
      text: "Source data",
    });
    await store.transaction(async (state) => {
      const ctx = { ...context(), workspace: state.product!.workspace };
      expect(
        (await connector.invoke(document.readOperation, {}, ctx)).data,
      ).toMatchObject({ text: "Source data" });
      const response = await connector.invoke(
        "workspace.save",
        { name: "result.txt", format: "text", text: "Transformed data" },
        ctx,
      );
      expect(response.target).toBe("result.txt");
      expect(state.product!.workspace.artifacts).toHaveLength(1);
    });
    expect((await store.read()).product!.workspace.artifacts[0].text).toBe(
      "Transformed data",
    );
  }, 2000);
  it("loads historical product state without workspace fields", () => {
    const historical = Object.fromEntries(
      Object.entries(emptyProductState()).filter(
        ([key]) => key !== "workspace",
      ),
    );
    expect(productStateSchema.parse(historical).workspace).toEqual({
      binding: "",
      documents: [],
      artifacts: [],
    });
  });
  it("types CSV column names as row keys so generic serialization compiles and preserves column order", async () => {
    const { store, fabric } = await harness();
    const file = await importWorkspaceDocument(store, {
      name: "roundtrip.csv",
      format: "csv",
      text: 'name,amount\n"Smith, Jane",12.50\n"He said ""Hi""",3.00\n',
    });
    await fabric.discover();
    const response = await fabric.invoke(file.readOperation, {}, context());
    const schema = fabric.operation(file.readOperation).outputSchema;
    const columns = (schema.properties as Record<string, unknown>).columns;
    expect(columns).toEqual({
      type: "array",
      items: { type: "string", enum: ["name", "amount"] },
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
    });
    for (const invalid of [["name", "unknown"], ["name"], ["name", "name"]])
      expect(() =>
        validateJson(
          schema,
          { ...(response.data as object), columns: invalid },
          "CSV read",
        ),
      ).toThrow(/schema/);
    const source = `function execute(input: ModuleInput): ModuleOutput {
      const file = input.observations.file;
      const lines: string[] = [];
      lines.push(file.columns.map(column => '"' + column.replaceAll('"', '""') + '"').join(','));
      for (const row of file.rows) {
        lines.push(file.columns.map(column => '"' + row[column].replaceAll('"', '""') + '"').join(','));
      }
      return {operations:[{operation:"workspace.save",arguments:{name:"roundtrip-output.csv",format:"csv",text:lines.join("\\n")}}],result:{summary:"CSV serialized"},state:{}};
    }`;
    const types = fabric.types({
      reads: [{ operation: file.readOperation, arguments: {}, ref: "file" }],
      actions: ["workspace.save"],
    });
    expect(types).toContain('Array<"name" | "amount">');
    expect(() => compileExecutable(source, "program/v1", types)).not.toThrow();
    const output = await runProgramExecutable(
      source,
      {
        now: context().now,
        input: {},
        state: {},
        observations: { file: response.data },
      },
      types,
    );
    expect(output.operations).toEqual([
      {
        operation: "workspace.save",
        arguments: {
          name: "roundtrip-output.csv",
          format: "csv",
          text: '"name","amount"\n"Smith, Jane","12.50"\n"He said ""Hi""","3.00"',
        },
      },
    ]);
  });
  it("rejects edited persisted inputs instead of changing their immutable identity", async () => {
    const { store, connector } = await harness();
    const file = await importWorkspaceDocument(store, {
      name: "input.txt",
      format: "text",
      text: "original",
    });
    await store.transaction((state) => {
      state.product!.workspace.documents[0].text = "tampered";
    });
    await expect(
      connector.invoke(file.readOperation, {}, context()),
    ).rejects.toThrow(/integrity/);
  });
  it("enforces bounded document capacity while retaining duplicate import idempotency", async () => {
    const { store } = await harness();
    for (let i = 0; i < 20; i++)
      await importWorkspaceDocument(store, {
        name: `file-${i}.txt`,
        format: "text",
        text: "content",
      });
    await expect(
      importWorkspaceDocument(store, {
        name: "file-0.txt",
        format: "text",
        text: "content",
      }),
    ).resolves.toHaveProperty("readOperation");
    await expect(
      importWorkspaceDocument(store, {
        name: "overflow.txt",
        format: "text",
        text: "content",
      }),
    ).rejects.toThrow(/capacity/);
    expect((await store.read()).product!.workspace.documents).toHaveLength(20);
  });
});
