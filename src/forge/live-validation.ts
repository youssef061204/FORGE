import { validateCapability, derivePermissions, type Capability } from "./spec";
import type { Check, ValidationReport } from "./records";
import { digest } from "./hash";
import { compileExecutable, runExecutable } from "./executable";
import { FixtureConnector } from "./connectors";
import { replayHistory, fixtureSenders, replayLabels } from "./replay-fixtures";
import { MemoryStateStore } from "./store";
import type { Sandbox } from "./sandbox";
import { PermissionBroker } from "./broker";
import type { LiveContext } from "./live-broker";

export async function validateLiveRelease(
  cap: Capability,
  sandbox: Sandbox,
  observe?: (stage: string) => void,
): Promise<ValidationReport> {
  const checks: Check[] = [];
  const input = (i: number) => ({
    email: replayHistory.emails[i],
    events: replayHistory.events,
    trustedSenders: fixtureSenders,
  });
  const verify = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
    return message;
  };
  const rejects = async (fn: () => unknown | Promise<unknown>) => {
    try {
      await fn();
    } catch {
      return "Denied as required";
    }
    throw new Error("Unexpected acceptance");
  };
  async function check(
    name: string,
    category: Check["category"],
    fn: () => unknown | Promise<unknown>,
  ) {
    const at = performance.now();
    observe?.(
      category === "test" ? "Running tests" : "Running security checks",
    );
    try {
      const result = await fn();
      checks.push({
        name,
        category,
        passed: true,
        details:
          typeof result === "string" ? result : "Executed deterministic check",
        durationMs: Math.round(performance.now() - at),
      });
    } catch (e) {
      checks.push({
        name,
        category,
        passed: false,
        details: e instanceof Error ? e.message : "Check failed",
        durationMs: Math.round(performance.now() - at),
      });
    }
  }
  await check("generated source strict typecheck", "test", () => {
    compileExecutable(cap.executable!.source);
    return "TypeScript strict compilation succeeded";
  });
  for (let i = 0; i < replayHistory.emails.length; i++)
    await check(`held-out labeled email ${i + 1}`, "test", async () => {
      const result = await runExecutable(cap.executable!.source, input(i));
      // Duplicate fixture is evaluated with the historical update already applied.
      if (i === 4) {
        const duplicateInput = input(i);
        duplicateInput.events = [
          { ...replayHistory.events[0], date: "2026-10-15" },
        ];
        const duplicate = await runExecutable(
          cap.executable!.source,
          duplicateInput,
        );
        return verify(!duplicate.change, "Duplicate deadline ignored");
      }
      const expected = replayLabels[replayHistory.emails[i].id];
      return verify(
        digest(
          result.change ? { ...result.change, notify: result.notify } : null,
        ) === digest(expected),
        "Output matched independent label",
      );
    });
  await check("workflow executes through sandbox", "test", async () => {
    const context: LiveContext = {
      mode: "REPLAY",
      connector: new FixtureConnector(),
      history: structuredClone(replayHistory),
      effects: [],
    };
    const execution = await sandbox.run(
      cap,
      {
        id: "live-admission",
        type: cap.trigger,
        payload: { text: "Replay", email: replayHistory.emails[0] },
      },
      new MemoryStateStore(),
      undefined,
      context,
    );
    return verify(
      execution.status === "success" && context.effects.length === 2,
      "Workflow proposed deadline update and study block with zero writes",
    );
  });
  await check("malformed module input", "test", () =>
    rejects(() =>
      runExecutable(cap.executable!.source, {
        ...input(0),
        email: { ...input(0).email, body: 42 },
      }),
    ),
  );
  await check("bounded source artifact", "test", () =>
    rejects(() => compileExecutable("x".repeat(16001))),
  );
  await check("least privilege derivation", "test", () =>
    verify(
      digest(cap.permissions) === digest(derivePermissions(cap.nodes)),
      "Exact operation permissions",
    ),
  );
  await check("trigger filtering", "test", async () =>
    verify(
      (
        await sandbox.run(
          cap,
          {
            id: "wrong-trigger",
            type: cap.trigger === "manual" ? "scheduled" : "manual",
            payload: {},
          },
          new MemoryStateStore(),
        )
      ).status === "ignored",
      "Unrelated trigger ignored",
    ),
  );
  await check("zero authority without context", "security", async () => {
    const store = new MemoryStateStore();
    const result = await sandbox.run(
      cap,
      { id: "zero-auth", type: cap.trigger, payload: { text: "Run" } },
      store,
    );
    return verify(
      result.status === "failed" &&
        result.permissionDenials >= 1 &&
        result.trace.every((step) => step.status === "denied") &&
        Object.keys((await store.read()).effects).length === 0,
      "Every bounded retry denied; zero effects",
    );
  });
  await check("undeclared operation denied", "security", async () =>
    rejects(() =>
      new PermissionBroker(
        cap,
        { id: "attack", type: cap.trigger, payload: {} },
        new MemoryStateStore(),
      ).invoke(cap.nodes[0].id, "email.send"),
    ),
  );
  await check("generated secret access denied", "security", () =>
    rejects(() =>
      compileExecutable(
        "function execute(input: ModuleInput): ModuleOutput { return process.env; }",
      ),
    ),
  );
  await check("generated network access denied", "security", () =>
    rejects(() =>
      compileExecutable(
        "function execute(input: ModuleInput): ModuleOutput { fetch('https://example.org'); return {change:null,notify:false}; }",
      ),
    ),
  );
  await check("unknown executable output denied", "security", () =>
    rejects(() =>
      runExecutable(
        "function execute(input: ModuleInput): ModuleOutput { return {change:null,notify:false, secret:'x'}; }",
        input(0),
      ),
    ),
  );
  await check("cycle rejected", "security", () =>
    rejects(() =>
      validateCapability({
        ...cap,
        nodes: cap.nodes.map((n, i) =>
          i === 0 ? { ...n, dependsOn: [cap.nodes.at(-1)!.id] } : n,
        ),
      }),
    ),
  );
  await check("approval bypass rejected", "security", () =>
    rejects(() =>
      validateCapability({
        ...cap,
        policies: { ...cap.policies, approvalRequired: false },
      }),
    ),
  );
  await check("unbounded tool calls rejected", "security", () =>
    rejects(() =>
      validateCapability({
        ...cap,
        policies: { ...cap.policies, maxToolCalls: 999 },
      }),
    ),
  );
  return {
    digest: digest(cap),
    completedAt: new Date().toISOString(),
    checks,
    passed: checks.every((c) => c.passed),
  };
}
