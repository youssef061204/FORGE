import { writeFile } from "node:fs/promises";
import { createCity, controlCity } from "../../src/forge/city-engine";
import { developmentGoal, developmentSource } from "../../src/forge/city-model";
import { cityCapability, rollout, summarize } from "../../src/forge/futures";
import { IsolatedSandbox } from "../../src/forge/sandbox";
const goal = structuredClone(developmentGoal);
goal.objectives = [
  { metric: "responseSeconds", direction: "minimize", weight: 1 },
  { metric: "exposedPeople", direction: "minimize", weight: 1 },
];
function responders(central: boolean) {
  return (
    'function execute(input: ModuleInput): ModuleOutput {const city=input.environment;const actions:ModuleOutput["actions"]=[]; const used:string[]=[];' +
    'function reachable(start:string,end:string):boolean {const q=[start],seen:string[]=[];for(let i=0;i<q.length&&i<64;i++){const n=q[i];if(n===end)return true;if(seen.includes(n))continue;seen.push(n);for(const r of city.roads){if(r.closed||r.risk>=.65)continue;const next=r.from===n?r.to:r.to===n?r.from:"";if(next&&!seen.includes(next)&&!q.includes(next))q.push(next)}}return false;}' +
    "const incidents=city.hazards.filter(h=>h.active).sort((a,b)=>b.intensity-a.intensity);" +
    'for(const kind of ["ambulance","fire","police"]){const local=city.vehicles.filter(v=>v.kind===kind&&v.dispatchAt===null).slice(0,3);for(const v of local){' +
    "const bids=city.buildings.map(b=>({b,cost:Math.hypot(v.x-b.x,v.y-b.y)-200*incidents.filter(h=>Math.hypot(b.x-h.x,b.y-h.y)<h.radius).reduce((s,h)=>s+h.intensity,0)})).sort((a,b)=>a.cost-b.cost);for(const bid of bids){" +
    (central ? "if(used.includes(bid.b.id))continue;" : "") +
    'if(!reachable(v.path[0],bid.b.node))continue;actions.push({operation:"vehicle.dispatch",vehicleId:v.id,destination:bid.b.id});used.push(bid.b.id);break;}}}' +
    'for(const b of city.buildings){if(b.kind==="shelter"&&b.mode!=="emergency"&&b.damage<=.6)actions.push({operation:"shelter.activate",buildingId:b.id});if(!b.critical&&b.power>.7)actions.push({operation:"grid.shed",buildingId:b.id,power:.7});}return {actions:actions.slice(0,48)};}'
  );
}
const policies = {
  baseline: developmentSource(2, true),
  decentralized: responders(false),
  centralized: responders(true),
};
const sandbox = new IsolatedSandbox("process"),
  cases = [],
  by: Record<string, Parameters<typeof summarize>[0]> = {
    baseline: [],
    decentralized: [],
    centralized: [],
  };
for (let i = 0; i < 12; i++) {
  const city = createCity(49500000 + i * 79);
  for (let j = 0; j < 3; j++)
    controlCity(city, {
      operation: "hazard.create",
      kind: (["flood", "wildfire", "gas"] as const)[j],
      x: city.nodes[(i * 3 + j * 7) % 48].x,
      y: city.nodes[(i * 3 + j * 7) % 48].y,
      radius: 190,
      intensity: 0.6,
    });
  const results = [];
  for (const [name, source] of Object.entries(policies)) {
    const r = await rollout(
      city,
      49600000 + i * 83,
      goal,
      cityCapability(goal, source, name),
      sandbox,
      false,
    );
    by[name].push(r.rollout);
    results.push({ name, ...r.rollout });
  }
  cases.push({ episode: i, results });
}
await writeFile(
  "artifacts/ml/multi-agent.json",
  JSON.stringify(
    {
      scope:
        "Five bounded rule agents: ambulance, fire, police, grid and shelter. Strategic severity ordering, tactical safe graph reachability; actual broker execution. No claim that agents are independently learned.",
      episodes: 12,
      policies,
      cases,
      summaries: Object.fromEntries(
        Object.keys(by).map((k) => [k, summarize(by[k])]),
      ),
    },
    null,
    2,
  ),
);
