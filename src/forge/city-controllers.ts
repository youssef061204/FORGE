import learned from "./rl-model.json";
import { createCity, controlCity } from "./city-engine";
import { developmentGoal, developmentSource } from "./city-model";
import { cityCapability, rollout, summarize } from "./futures";
import { IsolatedSandbox } from "./sandbox";
import { compileExecutable } from "./executable";
type Learned = {
  version: string;
  weights: Record<string, number[][] | number[]>;
  datasetHash: string;
};
const model = learned as unknown as Learned;
export type ControllerKind =
  "fixed" | "pressure" | "optimizer" | "rl" | "hybrid" | "generated-fixture";
/** Every controller is ordinary reviewable software using existing actuators. */
export function controllerSource(kind: ControllerKind) {
  if (kind === "fixed")
    return "function execute(input: ModuleInput): ModuleOutput { return { actions: [] }; }";
  if (kind === "generated-fixture") return developmentSource(1);
  if ((kind === "rl" || kind === "hybrid") && model.version !== "signal-dqn-1")
    throw new Error("Trained RL controller required");
  const weights =
    kind === "rl" || kind === "hybrid"
      ? "const weights1 = " +
        JSON.stringify(model.weights["0.weight"]) +
        ";const bias1 = " +
        JSON.stringify(model.weights["0.bias"]) +
        ";const weights2 = " +
        JSON.stringify(model.weights["2.weight"]) +
        ";const bias2 = " +
        JSON.stringify(model.weights["2.bias"]) +
        ";"
      : "";
  const choose =
    kind === "rl" || kind === "hybrid"
      ? 'const features=[ns/10,ew/10,nsWait/120,ewWait/120,n.signal==="ns"?1:0,n.signalRemaining/20]; const hidden=weights1.map((row,i)=>Math.max(0,row.reduce((sum,w,j)=>sum+w*features[j],bias1[i]))); const q=weights2.map((row,i)=>row.reduce((sum,w,j)=>sum+w*hidden[j],bias2[i])); const phase=q[0]>q[1]?"ns":"ew"; const score=Math.abs(q[0]-q[1]);'
      : 'const phase=nsWait+ns*3>ewWait+ew*3?"ns":"ew";const score=Math.abs(nsWait+ns*3-ewWait-ew*3);';
  return (
    "function execute(input: ModuleInput): ModuleOutput { " +
    weights +
    'const city=input.environment; const options: {nodeId:string;phase:"ns"|"ew";score:number}[]=[]; const eligible=city.nodes.filter(n=>n.signalRemaining<=5).slice(0,12); for(const n of eligible) { let ns=0,ew=0,nsWait=0,ewWait=0;for(const v of city.vehicles) {if(v.path[0]!==n.id||v.wait<=0||v.path.length<2)continue;const next=city.nodes.find(p=>p.id===v.path[1]);if(!next)continue;if(next.y!==n.y){ns++;nsWait+=v.wait;}else{ew++;ewWait+=v.wait;} } ' +
    choose +
    " if(phase!==n.signal&&ns+ew>0&&score>0) options.push({nodeId:n.id,phase,score}); } " +
    (kind === "optimizer" || kind === "hybrid"
      ? "options.sort((a,b)=>b.score-a.score);"
      : "") +
    'return {actions:options.slice(0,8).map(o=>({operation:"signal.set",nodeId:o.nodeId,phase:o.phase,seconds:18}))}; }'
  );
}
export async function runControllerBenchmark() {
  const sandbox = new IsolatedSandbox("process");
  const goal = structuredClone(developmentGoal);
  goal.goal = "Reduce traffic delay with safe signal control";
  goal.interpretation = "Frozen paired controller benchmark";
  goal.objectives = [
    { metric: "congestion", direction: "minimize", weight: 1 },
  ];
  const kinds: ControllerKind[] = [
    "fixed",
    "pressure",
    "optimizer",
    "rl",
    "hybrid",
    "generated-fixture",
  ];
  const cases: unknown[] = [];
  const outcomes: Record<string, Parameters<typeof summarize>[0]> =
    Object.fromEntries(kinds.map((k) => [k, []]));
  const started = performance.now();
  for (let e = 0; e < 24; e++) {
    const seed = 22587600 + e * 6121,
      city = createCity(seed);
    if (e % 2 === 0) controlCity(city, { operation: "traffic.add", count: 25 });
    if (e % 3 === 0)
      controlCity(city, {
        operation: "hazard.create",
        kind: "traffic",
        x: city.nodes[(e * 7) % 48].x,
        y: city.nodes[(e * 7) % 48].y,
        radius: 180,
        intensity: 0.65,
      });
    const results: unknown[] = [];
    for (const kind of kinds) {
      const source = controllerSource(kind);
      compileExecutable(source, "city/v1");
      const cap =
        kind === "fixed" ? undefined : cityCapability(goal, source, kind);
      const result = await rollout(city, seed + 171, goal, cap, sandbox, false);
      outcomes[kind].push(result.rollout);
      results.push({ controller: kind, ...result.rollout });
    }
    cases.push({ episode: e, seed, results });
    if (e % 4 === 0) console.log("Paired controller cases " + e + "/24");
  }
  return {
    createdAt: new Date().toISOString(),
    scope:
      "Actual full City, paired 120-second Futures, isolated worker and broker; controllers execute every 40 seconds to match current FORGE deployment cadence.",
    trainedCadenceSeconds: 10,
    evaluatedCadenceSeconds: 40,
    heldoutScenarios: 24,
    model: model.version,
    datasetHash: model.datasetHash,
    durationMs: Math.round(performance.now() - started),
    summaries: Object.fromEntries(
      kinds.map((k) => [k, summarize(outcomes[k])]),
    ),
    cases,
    limitations: [
      "Offline DQN training; online-policy generalization is measured here, not assumed.",
      "Fixed and pressure baselines differ in signal decisions only; fixture generated controller is explicitly not Bedrock.",
      "Optimizer solves a bounded linear switch-allocation surrogate, not global dynamic traffic optimization.",
      "A live Bedrock comparator is added only from actual recorded compiler evidence.",
    ],
  };
}
