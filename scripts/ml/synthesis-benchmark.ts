import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createCity } from "../../src/forge/city-engine";
import {
  developmentGoal,
  developmentSource,
  BedrockEnvironmentModel,
  environmentResponseSchema,
} from "../../src/forge/city-model";
import { cityCapability } from "../../src/forge/futures";
import { compileExecutable } from "../../src/forge/executable";
import { IsolatedSandbox } from "../../src/forge/sandbox";
import { MemoryStateStore } from "../../src/forge/store";
import { TwinEnvironmentProvider } from "../../src/forge/environment";
import { digest } from "../../src/forge/hash";
import { meteredClient } from "./paid-budget";
import { assertPaidActionAllowed } from "../../src/forge/cost-policy";
if (process.argv.includes("--live"))
  assertPaidActionAllowed("Live Amazon Bedrock synthesis benchmark");
const sandbox = new IsolatedSandbox("process"),
  out = "artifacts/ml";
await mkdir(out, { recursive: true });
async function preflight(
  source: string,
  goal = developmentGoal,
  seed = 45000000,
) {
  const start = performance.now();
  let compile = false,
    execution = false,
    error: string | undefined;
  try {
    compileExecutable(source, "city/v1");
    compile = true;
    const cap = cityCapability(goal, source, "frozen benchmark"),
      store = new MemoryStateStore();
    await store.transaction((s) => {
      s.city = createCity(seed);
    });
    const result = await sandbox.run(
      cap,
      { id: "frozen", type: "manual", payload: {} },
      store,
      undefined,
      {
        kind: "city",
        mode: "FUTURES",
        provider: new TwinEnvironmentProvider(store),
        goal,
        binding: (await store.read()).city!.id,
      },
    );
    execution = result.status === "success";
    error = result.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { compile, execution, error, durationMs: performance.now() - start };
}
const local: {
  case: number;
  seed: number;
  sourceHash: string;
  compile: boolean;
  execution: boolean;
  error?: string;
  durationMs: number;
}[] = [];
for (let i = 0; i < 100; i++) {
  const original = developmentSource(i % 3, true),
    source = original.replaceAll("18", "" + (12 + (i % 24)));
  local.push({
    case: i,
    seed: 45000000 + i * 139,
    sourceHash: digest(source),
    ...(await preflight(source, developmentGoal, 45000000 + i * 139)),
  });
}
let live: unknown[] = [];
try {
  live =
    JSON.parse(await readFile(out + "/program-synthesis.json", "utf8")).live ??
    [];
} catch {}
const save = () =>
  writeFile(
    out + "/program-synthesis.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        localScope:
          "100 frozen template-produced executable variants on distinct scenes; NOT 100 independently synthesized natural-language missions",
        local,
        live,
        localSchemaCompile: local.filter((c) => c.compile).length,
        localExecution: local.filter((c) => c.execution).length,
        realModelScope:
          "Only entries carrying actual Bedrock evidence are live synthesis. No fixture fallback.",
        programMemoryScope:
          "Synthetic current environment only; no owner data or cross-environment learned authority",
      },
      null,
      2,
    ),
  );
await save();
if (process.argv.includes("--live")) {
  process.env.FORGE_RUNTIME_MODE = "aws";
  process.env.AWS_PROFILE = "forge";
  process.env.AWS_REGION = "ca-central-1";
  process.env.BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  const model = new BedrockEnvironmentModel(
    process.env.BEDROCK_MODEL_ID,
    await meteredClient(),
  );
  const missions = [
    "Reduce traffic congestion with demand-responsive signals while preserving hospital power >=0.9.",
    "Reduce energy demand by shedding only noncritical buildings. Preserve hospital power >=0.9.",
    "Evacuate people threatened by flood toward reachable shelters. Respect capacity and preserve critical power.",
    "Prioritize emergency responders near active fires; dispatch only available responders over safe roads.",
    "Reduce smoke exposure and congestion, without reopening hazardous roads or overfilling shelters.",
    "Keep hospital power at least 0.9 during blackout; shed offices and homes only when required.",
    "Prepare shelters and safe pedestrian routes for a severe storm; keep critical services operating.",
    "Use measured directional vehicle waiting time to reduce queues; do not blindly oscillate signals.",
    "Maintain safe evacuation routes during earthquakes; never route across damaged or flooded roads.",
    "Reduce energy demand and traffic delays with independently designed policies, safety before optimization.",
    "Respond to a gas plume with safe evacuation and emergency dispatch; preserve hospital power.",
    "Manage a tornado threat through reachable shelter reservations and available responders.",
  ];
  for (let i = 0; i < missions.length; i++) {
    const store = new MemoryStateStore();
    await store.transaction((s) => {
      s.city = createCity(46000000 + i * 313);
    });
    const provider = new TwinEnvironmentProvider(store),
      city = await provider.observe();
    try {
      const generated = await model.generate(missions[i], provider, city),
        value = environmentResponseSchema.parse(generated.value);
      const programs =
        value.kind === "goal"
          ? await Promise.all(
              value.candidates.map(async (c) => ({
                name: c.name,
                source: c.source,
                hash: digest(c.source),
                ...(await preflight(c.source, value.contract, city.seed)),
              })),
            )
          : [];
      live.push({
        case: i,
        request: missions[i],
        kind: value.kind,
        evidence: generated.evidence,
        programs,
      });
      console.log(
        "Real Bedrock synthesis " + (i + 1) + "/12",
        generated.evidence.requestIds,
      );
    } catch (e) {
      live.push({
        case: i,
        request: missions[i],
        failed: true,
        error: e instanceof Error ? e.message : String(e),
      });
      await save();
      throw e;
    }
    await save();
  }
  const defects = [
      {
        category: "syntax",
        source:
          "function execute(input: ModuleInput): ModuleOutput { return {actions:[] ",
      },
      {
        category: "type",
        source:
          'function execute(input: ModuleInput): ModuleOutput { return {actions:"invalid"};}',
      },
      {
        category: "runtime",
        source:
          'function execute(input: ModuleInput): ModuleOutput { throw new Error("fault"); }',
      },
      {
        category: "timeout",
        source:
          "function execute(input: ModuleInput): ModuleOutput { while(true){} return {actions:[]}; }",
      },
      {
        category: "critical-power",
        source:
          'function execute(input: ModuleInput): ModuleOutput { const b=input.environment.buildings.find(b=>b.critical)!;return {actions:[{operation:"grid.shed",buildingId:b.id,power:0}]};}',
      },
      {
        category: "disconnected-route",
        source:
          'function execute(input: ModuleInput): ModuleOutput {const v=input.environment.vehicles[0];return {actions:[{operation:"vehicle.route",vehicleId:v.id,path:[v.path[0],"missing-node"]}]};}',
      },
    ],
    repairs = [];
  for (const [i, defect] of defects.entries()) {
    const before = await preflight(defect.source);
    const store = new MemoryStateStore();
    await store.transaction((s) => {
      s.city = createCity(47000000 + i * 137);
    });
    const provider = new TwinEnvironmentProvider(store),
      city = await provider.observe();
    try {
      const response = await model.generate(
        "Repair the supplied program while retaining this exact original GoalContract.",
        provider,
        city,
        undefined,
        JSON.stringify({
          contract: developmentGoal,
          candidates: [defect, defect, defect],
          compileFailures: [
            {
              id: "frozen",
              hash: digest(defect.source),
              failure: before.error,
            },
          ],
          instruction:
            "Repair source only; preserve the original mission and constraints.",
        }),
      );
      const after =
        response.value.kind === "goal"
          ? await preflight(
              response.value.candidates[0].source,
              developmentGoal,
              city.seed,
            )
          : { compile: false, execution: false };
      repairs.push({
        category: defect.category,
        before,
        after,
        attempts: 1,
        evidence: response.evidence,
        originalContractHash: digest(developmentGoal),
        returnedKind: response.value.kind,
      });
    } catch (e) {
      repairs.push({
        category: defect.category,
        before,
        failed: true,
        error: e instanceof Error ? e.message : String(e),
      });
      await writeFile(
        out + "/repair-benchmark.json",
        JSON.stringify(
          {
            scope:
              "Actual Bedrock repair, one attempt. Two/three attempts UNVERIFIED to preserve request cap.",
            repairs,
          },
          null,
          2,
        ),
      );
      throw e;
    }
    await writeFile(
      out + "/repair-benchmark.json",
      JSON.stringify(
        {
          scope:
            "Actual Bedrock repair, one attempt. Two/three attempts UNVERIFIED to preserve request cap.",
          repairs,
        },
        null,
        2,
      ),
    );
  }
}
console.log("Frozen program corpus complete");
