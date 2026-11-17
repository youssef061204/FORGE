import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultGrants, passportFor } from "../../src/core/contracts/passport";
import { recipeSchema } from "../../src/core/recipe/schema";
import { recipeHash } from "../../src/core/synth/crucible";
import { Broker } from "../../src/server/broker/broker";
import { BuildService } from "../../src/server/builds";
import { Bus } from "../../src/server/bus";
import { SandboxPool } from "../../src/server/sandbox/pool";
import { Scheduler } from "../../src/server/scheduler";
import { openDatabase } from "../../src/server/store/db";
import { Repo } from "../../src/server/store/repo";

const pool = new SandboxPool(1);
afterAll(() => pool.close());

describe("watched folder", () => {
  it("reruns a tool when a new export lands, never twice for the same file, and updates its dashboard", async () => {
    const repo = new Repo(openDatabase(":memory:"));
    const bus = new Bus();
    const broker = new Broker(repo, pool, bus);
    const recipe = recipeSchema.parse({
      inputs: [{ slot: "sales", format: "csv" }],
      steps: [{ op: "summarize", by: ["region"], set: { total: "sum(num(amount))" } }],
      outputs: [
        { kind: "file", name: "weekly.csv", format: "csv" },
        { kind: "view", type: "bar", x: "region", y: "total" },
      ],
    });
    const grants = defaultGrants(recipe);
    const { tool } = repo.install({ name: "Weekly sales", description: "Totals per region", requestKey: "weekly", hash: recipeHash(recipe), recipe, english: [], passport: passportFor(grants), grants, examples: [], buildId: "t", fileIds: [] });
    const folder = mkdtempSync(join(tmpdir(), "forge-watch-"));
    repo.setSchedule(tool.id, { kind: "folder", folder });
    const scheduler = new Scheduler({ repo, bus, pool, broker, builds: new BuildService(repo, bus) });

    writeFileSync(join(folder, "week-46.csv"), "region,amount\nNorth,10\nSouth,5\nNorth,2\n");
    await scheduler.tick();
    expect(repo.runs(tool.id)).toHaveLength(1);
    expect(repo.runs(tool.id)[0].trigger).toBe("folder");
    expect(JSON.parse(repo.latestView(tool.id)!.text).rows).toEqual([
      { region: "North", total: 12 },
      { region: "South", total: 5 },
    ]);

    await scheduler.tick();
    expect(repo.runs(tool.id)).toHaveLength(1);

    writeFileSync(join(folder, "week-47.csv"), "region,amount\nNorth,1\nWest,9\n");
    utimesSync(join(folder, "week-47.csv"), new Date(), new Date(Date.now() + 1000));
    await scheduler.tick();
    expect(repo.runs(tool.id)).toHaveLength(2);
    expect(JSON.parse(repo.latestView(tool.id)!.text).rows.map((r: { region: string }) => r.region)).toEqual(["North", "West"]);
  });
});
