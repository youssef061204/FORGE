import { validateCapability, type Capability } from "./spec";
import { digest } from "./hash";
import { compileExecutable } from "./executable";
import { createCity, applyCityAction } from "./city-engine";
import { MemoryStateStore } from "./store";
import { TwinEnvironmentProvider } from "./environment";
import { cityInputSchema } from "./city-contracts";
import type { Sandbox } from "./sandbox";
import type { Check, ValidationReport } from "./records";
export async function validateCityRelease(
  cap: Capability,
  sandbox: Sandbox,
  observe?: (stage: string) => void,
): Promise<ValidationReport> {
  const checks: Check[] = [];
  async function check(
    name: string,
    category: "test" | "security",
    fn: () => Promise<void> | void,
  ) {
    const started = performance.now();
    try {
      await fn();
      checks.push({
        name,
        category,
        passed: true,
        details: "Verified through the actual City contract, worker or broker",
        durationMs: Math.round(performance.now() - started),
      });
    } catch (e) {
      checks.push({
        name,
        category,
        passed: false,
        details: (e instanceof Error ? e.message : "Validation failure").slice(
          0,
          600,
        ),
        durationMs: Math.round(performance.now() - started),
      });
    }
  }
  observe?.("Typechecking generated City source");
  await check("Strict City schema and exact permissions", "test", () => {
    validateCapability(cap);
  });
  await check("Generated source strict TypeScript compile", "test", () => {
    compileExecutable(cap.executable!.source, "city/v1");
  });
  await check("Malformed observation rejected", "test", () => {
    if (cityInputSchema.safeParse({ environment: {}, goal: cap.goal }).success)
      throw new Error("Malformed input accepted");
  });
  observe?.("Executing City module in isolated sandbox");
  await check("Actual worker and broker proposals", "test", async () => {
    const store = new MemoryStateStore();
    await store.transaction((s) => {
      s.city = createCity(1349);
    });
    const provider = new TwinEnvironmentProvider(store);
    const run = await sandbox.run(
      cap,
      { id: "city-validation", type: cap.trigger, payload: {} },
      store,
      undefined,
      {
        kind: "city",
        mode: "FUTURES",
        provider,
        goal: cap.goal!,
        binding: "forge-city",
      },
    );
    if (run.status !== "success" || run.trace.length !== 3)
      throw new Error(run.error ?? "Incomplete broker trace");
  });
  observe?.("Checking City authority and safety boundaries");
  await check("No authority from generation", "security", async () => {
    const store = new MemoryStateStore();
    const provider = new TwinEnvironmentProvider(store);
    await provider.observe();
    let denied = false;
    try {
      await provider.execute([], {
        capability: cap,
        digest: digest(cap),
        binding: "forge-city",
        mode: "TWIN",
      });
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("Unapproved artifact acquired authority");
  });
  await check("Critical power shedding denied", "security", () => {
    const city = createCity(2);
    let denied = false;
    try {
      applyCityAction(city, {
        operation: "grid.shed",
        buildingId: city.buildings.find((b) => b.kind === "hospital")!.id,
        power: 0,
      });
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("Critical shedding accepted");
  });
  await check("Unsafe route and road reopening denied", "security", () => {
    const city = createCity(3);
    city.roads[0].risk = 0.9;
    let denied = false;
    try {
      applyCityAction(city, {
        operation: "road.open",
        roadId: city.roads[0].id,
      });
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("Hazardous road opened");
  });
  await check("Host/network escape source rejected", "security", () => {
    let denied = false;
    try {
      compileExecutable(
        'function execute(input: ModuleInput): ModuleOutput { fetch("https://invalid.test"); return {actions:[]}; }',
        "city/v1",
      );
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("Host escape compiled");
  });
  return {
    digest: digest(cap),
    completedAt: new Date().toISOString(),
    checks,
    passed: checks.every((c) => c.passed),
  };
}
