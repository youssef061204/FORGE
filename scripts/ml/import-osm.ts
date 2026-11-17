import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createCity, advanceCity } from "../../src/forge/city-engine";
import { citySchema } from "../../src/forge/city-contracts";
const directory = "artifacts/ml/external";
await mkdir(directory, { recursive: true });
const bounds = [-76.489, 44.228, -76.485, 44.232],
  url =
    "https://api.openstreetmap.org/api/0.6/map.json?bbox=" + bounds.join(",");
let raw: string;
try {
  raw = await readFile(directory + "/kingston-osm.json", "utf8");
} catch {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "FORGE research digital twin / small cached read-only map import",
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("OSM download HTTP " + response.status);
  raw = await response.text();
  await writeFile(directory + "/kingston-osm.json", raw);
}
type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
};
const data = JSON.parse(raw) as { elements: Element[] };
const ways = data.elements.filter(
  (e) =>
    e.type === "way" &&
    e.tags?.highway &&
    !["footway", "path", "steps", "pedestrian", "cycleway", "service"].includes(
      e.tags.highway,
    ),
);
const allowed = new Map(
  data.elements
    .filter(
      (e) =>
        e.type === "node" &&
        e.lon! >= bounds[0] &&
        e.lon! <= bounds[2] &&
        e.lat! >= bounds[1] &&
        e.lat! <= bounds[3],
    )
    .map((e) => [e.id, e]),
);
const segments = ways
  .flatMap((w) =>
    (w.nodes ?? [])
      .slice(1)
      .map((id, i) => ({ from: w.nodes![i], to: id, way: w.id })),
  )
  .filter((s) => allowed.has(s.from) && allowed.has(s.to));
const adjacency = new Map<number, Set<number>>();
for (const s of segments) {
  if (!adjacency.has(s.from)) adjacency.set(s.from, new Set());
  if (!adjacency.has(s.to)) adjacency.set(s.to, new Set());
  adjacency.get(s.from)!.add(s.to);
  adjacency.get(s.to)!.add(s.from);
}
// Keep the largest connected component and every intermediate geometry point.
const components: number[][] = [],
  seen = new Set<number>();
for (const id of adjacency.keys()) {
  if (seen.has(id)) continue;
  const q = [id];
  seen.add(id);
  for (let j = 0; j < q.length; j++)
    for (const n of adjacency.get(q[j])!) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  components.push(q);
}
const component = components.sort((a, b) => b.length - a.length)[0];
const ids = component?.slice(0, 64);
if (!ids?.length) throw new Error("Map contains no connected roads");
const kept = new Set(ids),
  city = createCity(48000000),
  sourceHash = createHash("sha256").update(raw).digest("hex");
city.id = "osm-kingston-" + sourceHash.slice(0, 12);
city.name = "Kingston map / simulated conditions";
city.map = {
  source: "OpenStreetMap",
  sourceHash,
  attribution: "© OpenStreetMap contributors · ODbL",
  bounds,
  simulatedConditions: true,
};
city.nodes = ids.map((id, i) => ({
  id: "osm-" + id,
  x:
    120 +
    ((allowed.get(id)!.lon! - bounds[0]) / (bounds[2] - bounds[0])) * 2000,
  y:
    120 +
    ((bounds[3] - allowed.get(id)!.lat!) / (bounds[3] - bounds[1])) * 1360,
  signal: i % 2 ? "ns" : "ew",
  signalSeconds: 20,
  signalRemaining: 20,
  powered: true,
}));
const nodeMap = new Map(city.nodes.map((n) => [n.id, n]));
city.roads = segments
  .filter((s) => kept.has(s.from) && kept.has(s.to))
  .filter(
    (s, i, a) =>
      a.findIndex(
        (v) =>
          (v.from === s.from && v.to === s.to) ||
          (v.from === s.to && v.to === s.from),
      ) === i,
  )
  .map((s, i) => {
    const a = nodeMap.get("osm-" + s.from)!,
      b = nodeMap.get("osm-" + s.to)!;
    return {
      id: "osm-road-" + i,
      from: a.id,
      to: b.id,
      length: Math.hypot(a.x - b.x, a.y - b.y),
      capacity: 9,
      baseCapacity: 9,
      closed: false,
      manualClosed: false,
      bridge: false,
      risk: 0,
      floodDepth: 0,
      smoke: 0,
      damage: 0,
      load: 0,
    };
  });
// Buildings, traffic, grid and hazards are synthetic. Only road geometry is imported.
city.buildings = city.buildings.map((b, i) => ({
  ...b,
  node: city.nodes[i % ids.length].id,
  x: Math.max(20, city.nodes[i % ids.length].x - 65),
  y: Math.max(20, city.nodes[i % ids.length].y - 110),
  w: 60,
  h: 55,
}));
city.vehicles = city.vehicles.slice(0, 25).map((v, i) => {
  const node = city.nodes[i % ids.length];
  return {
    ...v,
    path: [node.id],
    destination: node.id,
    x: node.x,
    y: node.y,
    progress: 0,
  };
});
city.pedestrians = city.pedestrians.slice(0, 40).map((p, i) => {
  const node = city.nodes[i % ids.length];
  return {
    ...p,
    path: [node.id],
    destination: node.id,
    x: node.x,
    y: node.y,
    progress: 0,
  };
});
delete city.gridNodes;
delete city.terrain;
delete city.deployment;
city.player = {
  x: city.nodes[0].x,
  y: city.nodes[0].y,
  vx: 0,
  vy: 0,
  moving: false,
  sprint: false,
  facing: "down",
  sequence: 0,
};
const parsed = citySchema.parse(city);
await mkdir("src/forge/maps", { recursive: true });
await writeFile("src/forge/maps/kingston.json", JSON.stringify(parsed));
for (let i = 0; i < 30; i++) advanceCity(parsed, 2, false);
await writeFile(
  "artifacts/ml/real-map.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      source: url,
      sourceHash,
      bounds,
      attribution: city.map.attribution,
      roadGeometry:
        "Actual OSM nodes/ways, bounded connected BFS subset; coordinates retain bends, remaining streets omitted",
      originalComponentNodes: component.length,
      nodes: city.nodes.length,
      roads: city.roads.length,
      executedSimulationSeconds: parsed.seconds,
      metrics: parsed.metrics,
      claim:
        "Real geometry, simulated conditions. Not live traffic or disaster prediction.",
      cityHash: createHash("sha256").update(JSON.stringify(city)).digest("hex"),
    },
    null,
    2,
  ),
);
console.log(
  "Real OSM geometry imported and simulated: " + ids.length + " nodes",
);
