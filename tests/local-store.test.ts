import { describe, expect, it } from "vitest";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStateStore } from "../src/forge/store";

describe("Local store snapshot isolation and external changes", () => {
  it("isolates read copies, retained transaction references and aborted transactions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-store-isolation-"));
    try {
      const store = new LocalStateStore(directory);
      const retained = await store.transaction((s) => {
        s.audit.push({
          at: "now",
          action: "test",
          capabilityId: "a",
          details: "original",
        });
        return s.audit;
      });
      retained[0].details = "mutated return";
      const read = await store.read();
      read.audit[0].details = "mutated read";
      await expect(
        store.transaction((s) => {
          s.audit[0].details = "aborted";
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect((await store.read()).audit[0].details).toBe("original");
      expect(
        (await new LocalStateStore(directory).read()).audit[0].details,
      ).toBe("original");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("reloads atomic external replacements and rejects corrupt or invalid persisted state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-store-replacement-"));
    try {
      const store = new LocalStateStore(directory);
      await store.transaction((s) => {
        s.audit.push({
          at: "now",
          action: "test",
          capabilityId: "a",
          details: "first",
        });
      });
      const state = await store.read();
      state.audit[0].details = "other";
      await writeFile(
        join(directory, "replacement.json"),
        JSON.stringify(state),
      );
      await rename(
        join(directory, "replacement.json"),
        join(directory, "forge.json"),
      );
      expect((await store.read()).audit[0].details).toBe("other");
      await writeFile(
        join(directory, "forge.json"),
        JSON.stringify({ ...state, releases: "invalid" }),
      );
      await expect(store.read()).rejects.toThrow();
      await writeFile(join(directory, "forge.json"), "invalid JSON");
      await expect(store.read()).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
