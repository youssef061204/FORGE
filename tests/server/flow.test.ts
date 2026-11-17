import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replay } from "../../src/core/events/reducer";
import { Broker, Denied } from "../../src/server/broker/broker";
import { BuildService } from "../../src/server/builds";
import { Bus } from "../../src/server/bus";
import { SandboxPool } from "../../src/server/sandbox/pool";
import { openDatabase } from "../../src/server/store/db";
import { Repo } from "../../src/server/store/repo";
import { SAMPLES } from "../../src/showcase/samples";

process.env.FORGE_MODEL_TRANSPORT = "scripted";

let repo: Repo, bus: Bus, pool: SandboxPool, builds: BuildService, broker: Broker;

async function finished(buildId: string) {
  for (let i = 0; i < 400; i++) {
    const b = repo.build(buildId);
    if (b?.status === "done") return b;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("build did not finish");
}

beforeAll(() => {
  repo = new Repo(openDatabase(":memory:"));
  bus = new Bus();
  pool = new SandboxPool(1);
  builds = new BuildService(repo, bus);
  broker = new Broker(repo, pool, bus);
});
afterAll(() => pool.close());

describe("build, approve, run, revoke", () => {
  it("runs the whole trust loop", async () => {
    const orders = SAMPLES.find((s) => s.id === "orders")!;
    const file = repo.addFile(orders.file.name, "csv", orders.file.text);
    const changes: string[] = [];
    bus.on((e) => e.t === "tools.changed" && changes.push(e.reason));

    const id = await builds.start({ request: orders.requests[0].text, fileIds: [file.id] });
    const build = await finished(id);
    expect(build.outcome).toBe("review");
    const view = replay(repo.events(id), id);
    expect(view.provenance).toBe("scripted");
    // Early exit: three agree and no rival has two, so the last draft is stopped.
    expect(view.consensus?.agreement).toBe("3 of 4 drafts agree");
    expect(Object.values(view.candidates).filter((c) => c.reject?.reason.startsWith("not needed"))).toHaveLength(1);
    expect(view.candidates.d3.status).toBe("outvoted");
    expect(view.review?.passport.cannot).toContain("Use the network");

    // Approval must match the reviewed hash exactly.
    expect(() => builds.approve(id, { hash: "0".repeat(64) })).toThrow(/doesn't match/);
    const { tool } = builds.approve(id, { hash: view.review!.hash });
    expect(changes).toEqual(["installed"]);

    // Runs go through the broker and the worker sandbox.
    const first = await broker.run(tool.id, [{ slot: "orders", fileId: file.id }], { eventKey: "evt-1" });
    expect(first.run.status).toBe("done");
    expect(first.artifacts.map((a) => a.name)).toEqual(["totals.json"]);
    const totals = JSON.parse(first.artifacts[0].text);
    expect(Object.keys(totals).length).toBeGreaterThan(3);

    // The same event never writes twice.
    const again = await broker.run(tool.id, [{ slot: "orders", fileId: file.id }], { eventKey: "evt-1" });
    expect(again.deduplicated).toBe(true);
    expect(repo.receipts(tool.id).filter((r) => r.kind === "write" && r.status === "committed")).toHaveLength(1);

    // Revoked tools refuse to run, with a receipt.
    builds.revoke(tool.id);
    expect(changes).toEqual(["installed", "revoked"]);
    await expect(broker.run(tool.id, [{ slot: "orders", fileId: file.id }])).rejects.toBeInstanceOf(Denied);
    expect(repo.receipts(tool.id).some((r) => r.kind === "deny" && /revoked/.test(r.detail))).toBe(true);
  });

  it("refuses a program altered after approval", async () => {
    const contacts = SAMPLES.find((s) => s.id === "contacts")!;
    const file = repo.addFile(contacts.file.name, "csv", contacts.file.text);
    const id = await builds.start({ request: contacts.requests[0].text, fileIds: [file.id] });
    await finished(id);
    const view = replay(repo.events(id), id);
    const { tool, version } = builds.approve(id, { hash: view.review!.hash });
    // Tamper with the stored recipe directly, bypassing every API.
    const tampered = { ...version.recipe, steps: [...version.recipe.steps, { op: "limit", n: 1 }] };
    repo.db.prepare("UPDATE versions SET recipe = ? WHERE tool_id = ? AND version = ?").run(JSON.stringify(tampered), tool.id, version.version);
    await expect(broker.run(tool.id, [{ slot: "contacts", fileId: file.id }])).rejects.toThrow(/changed after it was approved/);
  });

  it("refuses files outside an exact-file grant", async () => {
    const contacts = SAMPLES.find((s) => s.id === "contacts")!;
    const file = repo.addFile(contacts.file.name, "csv", contacts.file.text);
    const other = repo.addFile("other.csv", "csv", contacts.file.text);
    const id = await builds.start({ request: contacts.requests[0].text, fileIds: [file.id] });
    await finished(id);
    const view = replay(repo.events(id), id);
    const { tool } = builds.approve(id, { hash: view.review!.hash, scopes: { contacts: { kind: "read", slot: "contacts", scope: "exact-file", file: "contacts.csv" } } });
    await expect(broker.run(tool.id, [{ slot: "contacts", fileId: other.id }])).rejects.toThrow(/may only read contacts.csv/);
    const ok = await broker.run(tool.id, [{ slot: "contacts", fileId: file.id }]);
    expect(ok.run.status).toBe("done");
  });
});
