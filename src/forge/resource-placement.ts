import model from "./placement-model.json";
export type PlacementKind = "random" | "demand" | "optimization" | "learned";
/** Observed features match the episode generator. Output is ordinary broker-bound software. */
export function placementSource(kind: PlacementKind) {
  if (kind === "learned" && !model.trained)
    throw new Error("Resource demand model has not been trained");
  const prediction =
    kind === "learned"
      ? "const w=" +
        JSON.stringify(model.weights) +
        ";const demand=Math.max(0," +
        model.bias +
        "+features.reduce((s,v,j)=>s+v*w[j],0));"
      : "const demand=features[0];";
  return (
    "function execute(input: ModuleInput): ModuleOutput {" +
    'const city=input.environment;const units=["ambulance","fire","police"].map(k=>city.vehicles.find(v=>v.kind===k&&v.dispatchAt===null)).filter(v=>v!==undefined);' +
    'function path(start:string,end:string):string[]{const q:string[][]=[[start]],seen:string[]=[];for(let i=0;i<q.length&&i<64;i++){const p=q[i],n=p[p.length-1];if(n===end)return p;if(seen.includes(n))continue;seen.push(n);for(const r of city.roads){if(r.closed||r.risk>=.65)continue;const next=r.from===n?r.to:r.to===n?r.from:"";if(next&&!seen.includes(next)&&!q.some(a=>a[a.length-1]===next))q.push([...p,next]);}}return [];}' +
    'if(city.seconds%120>=80){const actions:ModuleOutput["actions"]=[];const incidents=city.hazards.filter(h=>h.active).slice(0,3);const used:string[]=[];for(const h of incidents){const targets=city.nodes.filter(n=>Math.hypot(n.x-h.x,n.y-h.y)<=h.radius).sort((a,b)=>Math.hypot(a.x-h.x,a.y-h.y)-Math.hypot(b.x-h.x,b.y-h.y));for(const n of targets){const available=units.filter(v=>v!==undefined&&!used.includes(v.id)).map(v=>({v,p:path(v!.path[0],n.id)})).filter(o=>o.p.length>0).sort((a,b)=>a.p.length-b.p.length);const pick=available[0];if(pick?.v){actions.push({operation:"vehicle.dispatch",vehicleId:pick.v.id,destination:n.id});used.push(pick.v.id);break;}}}return {actions};}' +
    "const demand=city.nodes.map(n=>{const roads=city.roads.filter(r=>r.from===n.id||r.to===n.id);const people=city.pedestrians.filter(p=>!p.evacuated&&Math.hypot(p.x-n.x,p.y-n.y)<240);const hazards=city.hazards.filter(h=>h.active&&Math.hypot(h.x-n.x,h.y-n.y)<h.radius+240);const exposed=people.filter(p=>city.hazards.some(h=>h.active&&Math.hypot(p.x-h.x,p.y-h.y)<h.radius)).length;" +
    "const cell=city.terrain?.cells[Math.min(19,Math.max(0,Math.floor(n.y/80)))*28+Math.min(27,Math.max(0,Math.floor(n.x/80)))];const b=city.buildings.find(b=>b.node===n.id);const features=[exposed,people.length,hazards.length,Math.max(0,...hazards.map(h=>h.intensity)),city.weather.rain,city.weather.wind,cell?.gas??0,cell?.fire??0,Math.max(cell?.water??0,...roads.map(r=>r.floodDepth)),Math.max(b?.damage??0,cell?.damage??0)];" +
    prediction +
    "return demand;});" +
    "const sites=city.nodes.filter((n,i)=>i%4===0).slice(0,12);const distances=sites.map(s=>city.nodes.map(n=>{const p=path(s.id,n.id);return p.length?p.length-1:64;}));let chosen:number[]=[];" +
    (kind === "random"
      ? "let seed=city.seed>>>0;for(let i=0;i<12&&chosen.length<units.length;i++){seed=(1664525*seed+1013904223)>>>0;const index=seed%sites.length;if(!chosen.includes(index))chosen.push(index);}"
      : kind === "demand"
        ? "chosen=sites.map((s,i)=>({i,d:demand[city.nodes.findIndex(n=>n.id===s.id)]})).sort((a,b)=>b.d-a.d).slice(0,units.length).map(v=>v.i);"
        : "let best=Infinity;for(let a=0;a<sites.length;a++)for(let b=a+1;b<sites.length;b++)for(let c=b+1;c<sites.length;c++){const picks=[a,b,c].slice(0,units.length);const cost=demand.reduce((s,d,j)=>s+d*Math.min(...picks.map(i=>distances[i][j])),0);if(cost<best){best=cost;chosen=picks;}}") +
    'const actions:ModuleOutput["actions"]=[];const used:number[]=[];for(const v of units){if(!v)continue;const options=chosen.filter(i=>!used.includes(i)).map(i=>({i,p:path(v.path[0],sites[i].id)})).filter(o=>o.p.length>0).sort((a,b)=>a.p.length-b.p.length);const pick=options[0];if(!pick)continue;used.push(pick.i);if(pick.p.length<2||v.destination===sites[pick.i].id)continue;actions.push({operation:"vehicle.route",vehicleId:v.id,path:pick.p});}return {actions};}'
  );
}
