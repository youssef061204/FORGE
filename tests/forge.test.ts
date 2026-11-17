import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoPlan, resolveCapability, compile } from "../src/forge/compiler";
import { validateCapability, derivePermissions } from "../src/forge/spec";
import { DemoModelProvider } from "../src/forge/models";
import {
  scoutRequest,
  extensionRequest,
  postings,
} from "../src/forge/fixtures";
import { LocalStateStore, MemoryStateStore } from "../src/forge/store";
import { IsolatedSandbox } from "../src/forge/sandbox";
import { PermissionBroker } from "../src/forge/broker";
import { ForgeService } from "../src/forge/service";
import { validateRelease } from "../src/forge/validation";
import { digest } from "../src/forge/hash";

describe("ForgeSpec compiler and policy", () => {
  it("generates a typed minimal-permission program from a request", () => {
    const c = demoPlan(scoutRequest);
    expect(c.nodes.length).toBe(6);
    expect(c.permissions).toEqual([
      "notifications.write",
      "personal_resume.read",
      "public_web.read",
    ]);
    expect(c.edges).toHaveLength(6);
  });
  it.each([
    "email.send",
    "purchase an item",
    "delete files",
    "send email",
    "submit application",
  ])("blocks forbidden intent: %s", (request) =>
    expect(() => demoPlan(request)).toThrow(/forbidden/),
  );
  it("rejects cycles before launching a worker", () => {
    const c = demoPlan(scoutRequest);
    c.nodes[0].dependsOn = ["notify"];
    c.edges.push({ from: "notify", to: c.nodes[0].id });
    expect(() => validateCapability(c)).toThrow(/cycle/);
  });
  it("rejects an extra permission", () => {
    const c = demoPlan(scoutRequest);
    c.permissions.push("documents.write");
    expect(() => validateCapability(c)).toThrow(/minimum/);
  });
  it("rejects missing input ancestry", () => {
    const c = demoPlan(scoutRequest);
    c.nodes.find((n) => n.id === "score-match")!.dependsOn = [
      "normalize-posting",
    ];
    c.edges = c.nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({ from, to: n.id })),
    );
    expect(() => validateCapability(c)).toThrow(/typed input/);
  });
  it("retrieves exact matches and extensions", () => {
    const cap = demoPlan(scoutRequest);
    expect(resolveCapability(scoutRequest, [cap]).kind).toBe("EXACT_MATCH");
    expect(resolveCapability(extensionRequest, [cap]).kind).toBe("EXTEND");
  });
  it("reuses matching installed primitive nodes when composing", async () => {
    const cap = demoPlan(scoutRequest);
    const result = await compile(
      "Monitor a new internship and compare my resume; tell me about strong Python candidates",
      [cap],
      new DemoModelProvider(),
    );
    expect(result.resolution).toBe("COMPOSE");
    expect(result.reusedNodes.length).toBeGreaterThan(0);
  });
  it("creates a semantic minor patch with exactly one new permission", () => {
    const previous = demoPlan(scoutRequest);
    const cap = demoPlan(extensionRequest, previous);
    expect(cap.version).toBe("1.1.0");
    expect(cap.parentVersion).toBe("1.0.0");
    expect(
      derivePermissions(cap.nodes).filter(
        (p) => !previous.permissions.includes(p),
      ),
    ).toEqual(["documents.write"]);
  });
  it("hashes equivalent object order canonically", () =>
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 })));
});
describe("execution boundary", () => {
  const sandbox = new IsolatedSandbox();
  it("preserves the original notification threshold when adding a stricter cover-letter branch", async () => {
    const extended = demoPlan(extensionRequest, demoPlan(scoutRequest));
    const store = new MemoryStateStore();
    const job = {
      ...postings.amd,
      requirements: ["Python", "PyTorch", "C++", "GPU", "accounting"],
    };
    const run = await sandbox.run(
      extended,
      { id: "match-80", type: "new_job_posting", payload: { posting: job } },
      store,
    );
    expect(run.status, run.error).toBe("success");
    expect(run.outcome["score-match"]).toMatchObject({ matchScore: 80 });
    expect(
      run.trace.find((t) => t.operation === "cover_letter.generate")?.status,
    ).toBe("skipped");
    expect(
      Object.values((await store.read()).effects).map((e) => e.kind),
    ).toEqual(["notification"]);
  });
  it("actually executes the fixture and persists a notification", async () => {
    const store = new MemoryStateStore();
    const run = await sandbox.run(
      demoPlan(scoutRequest),
      {
        id: "evt-1",
        type: "new_job_posting",
        payload: { posting: postings.amd },
      },
      store,
    );
    expect(run.status, run.error).toBe("success");
    expect(run.outcome["score-match"]).toMatchObject({ matchScore: 100 });
    expect(run.trace).toHaveLength(6);
    expect(Object.values((await store.read()).effects)[0].kind).toBe(
      "notification",
    );
  });
  it("does not notify below threshold", async () => {
    const store = new MemoryStateStore();
    const run = await sandbox.run(
      demoPlan(scoutRequest),
      {
        id: "evt-2",
        type: "new_job_posting",
        payload: { posting: postings.irrelevant },
      },
      store,
    );
    expect(run.status, run.error).toBe("success");
    expect(run.trace.at(-1)?.status).toBe("skipped");
    expect(Object.keys((await store.read()).effects)).toHaveLength(0);
  });
  it("enforces permission at the broker and records denial", async () => {
    const cap = demoPlan(scoutRequest);
    cap.permissions = [];
    const broker = new PermissionBroker(
      cap,
      {
        id: "denied",
        type: "new_job_posting",
        payload: { posting: postings.amd },
      },
      new MemoryStateStore(),
    );
    await expect(
      broker.invoke("retrieve-resume", "resume.read"),
    ).rejects.toThrow(/Permission denied/);
    expect(broker.permissionDenials).toBe(1);
    expect(broker.trace[0].status).toBe("denied");
  });
  it("runs all generated tests and security attacks", async () => {
    const report = await validateRelease(demoPlan(scoutRequest));
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.checks).toHaveLength(22);
    expect(report.passed).toBe(true);
  });
  it("runs real transform and scheduled summary workflows", async () => {
    for (const request of [
      "Transform text to uppercase",
      "Summarize text daily and notify me",
    ]) {
      const cap = demoPlan(request);
      const run = await sandbox.run(
        cap,
        {
          id: request,
          type: cap.trigger,
          payload: { text: "Hello FORGE. New ability." },
        },
        new MemoryStateStore(),
      );
      expect(run.status, run.error).toBe("success");
    }
  });
});
describe("lifecycle and storage", () => {
  it("approval, trigger, modification, repair and rollback work end to end", async () => {
    const store = new MemoryStateStore();
    const service = new ForgeService(store);
    const v1 = await service.propose(scoutRequest);
    expect(
      v1.status,
      JSON.stringify(v1.report.checks.filter((c) => !c.passed)),
    ).toBe("review");
    await expect(
      service.trigger(v1.definition.id, {
        id: "unapproved",
        type: "new_job_posting",
        payload: { posting: postings.amd },
      }),
    ).rejects.toThrow(/approved/);
    await expect(
      service.approve(v1.definition.id, "1.0.0", "wrong-digest"),
    ).rejects.toThrow(/integrity/);
    await service.approve(v1.definition.id, "1.0.0", v1.digest);
    const evt = {
      id: "event-installed",
      type: "new_job_posting",
      payload: { posting: postings.amd },
    };
    const runs = await Promise.all([
      service.trigger("internship-scout", evt),
      service.trigger("internship-scout", evt),
    ]);
    expect(runs[0].id).toBe(runs[1].id);
    expect((await store.read()).executions).toHaveLength(1);
    const v2 = await service.propose(extensionRequest);
    expect(v2.definition.version).toBe("1.1.0");
    expect(v2.diff.addedPermissions).toEqual(["documents.write"]);
    await service.approve("internship-scout", "1.1.0", v2.digest);
    const withLetter = await service.trigger("internship-scout", {
      ...evt,
      id: "letter",
    });
    expect(withLetter.status).toBe("success");
    expect(
      Object.values((await store.read()).effects).some(
        (e) => e.kind === "document",
      ),
    ).toBe(true);
    const broken = await service.trigger("internship-scout", {
      ...evt,
      id: "changed",
      payload: { posting: postings.changed },
    });
    expect(broken.status).toBe("failed");
    const repair = await service.repair("internship-scout");
    expect(repair.definition.version).toBe("1.1.1");
    expect(repair.report.passed).toBe(true);
    expect(repair.diff.addedPermissions).toEqual([]);
    await service.approve("internship-scout", "1.1.1", repair.digest);
    expect(
      (
        await service.trigger("internship-scout", {
          ...evt,
          id: "changed",
          payload: { posting: postings.changed },
        })
      ).status,
    ).toBe("success");
    await service.rollback("internship-scout", "1.0.0");
    expect(
      (await service.snapshot()).releases.find((r) => r.status === "installed")
        ?.definition.version,
    ).toBe("1.0.0");
  });
  it("rejects tampered code after successful validation", async () => {
    const store = new MemoryStateStore();
    const service = new ForgeService(store);
    const r = await service.propose(scoutRequest);
    await store.transaction((s) => {
      s.releases[0].definition.nodes[0].label = "Changed after validation";
    });
    await expect(
      service.approve(r.definition.id, r.definition.version, r.digest),
    ).rejects.toThrow(/integrity/);
  });
  it("persists state across adapters and serializes concurrent writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-test-"));
    try {
      const store = new LocalStateStore(directory);
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          store.transaction((s) => {
            s.audit.push({
              at: new Date().toISOString(),
              action: "test",
              capabilityId: "test",
              details: String(i),
            });
          }),
        ),
      );
      expect((await new LocalStateStore(directory).read()).audit).toHaveLength(
        8,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rolls back failed transactions", async () => {
    const store = new MemoryStateStore();
    await expect(
      store.transaction((s) => {
        s.audit.push({ at: "", action: "", capabilityId: "", details: "" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await store.read()).audit).toHaveLength(0);
  });
});
