import { randomBytes } from "node:crypto";
import {
  ensureCityFields,
  advanceTerrain,
  advanceGridAndDemand,
  terrainAt,
} from "./city-terrain";
import {
  citySchema,
  simulationControlSchema,
  type City,
  type CityAction,
  type CityMetrics,
  type GoalContract,
  type SimulationControl,
  type FutureFrame,
} from "./city-contracts";

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export function random(city: Pick<City, "seed">) {
  city.seed = (Math.imul(city.seed, 1664525) + 1013904223) >>> 0;
  return city.seed / 4294967296;
}
export function cityEvent(
  city: City,
  text: string,
  origin: "simulation" | "human" | "capability",
  identity?: { capabilityId: string; digest: string; operation: string },
) {
  city.events.push({
    id: "e-" + city.revision + "-" + city.events.length + "-" + city.seconds,
    at: city.seconds,
    text: text.slice(0, 300),
    origin,
    ...identity,
  });
  city.events = city.events.slice(-80);
}
export function roadBetween(city: City, a: string, b: string) {
  let index = roadIndexes.get(city.roads);
  if (!index) {
    index = new Map();
    for (const road of city.roads) {
      index.set(road.from + "|" + road.to, road);
      index.set(road.to + "|" + road.from, road);
    }
    roadIndexes.set(city.roads, index);
  }
  return index.get(a + "|" + b);
}
const roadIndexes = new WeakMap<
  City["roads"],
  Map<string, City["roads"][number]>
>();
export function findPath(
  city: City,
  start: string,
  destination: string,
  avoidRisk = true,
): string[] {
  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const remaining = new Set(city.nodes.map((n) => n.id));
  while (remaining.size) {
    const current = [...remaining].sort(
      (a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity),
    )[0];
    if (!Number.isFinite(distances.get(current) ?? Infinity)) break;
    remaining.delete(current);
    if (current === destination) break;
    for (const road of city.roads) {
      if (road.closed || (avoidRisk && road.risk >= 0.65)) continue;
      const next =
        road.from === current
          ? road.to
          : road.to === current
            ? road.from
            : undefined;
      if (!next || !remaining.has(next)) continue;
      const distance =
        distances.get(current)! +
        road.length * (1 + road.load / road.capacity + road.risk * 6);
      if (distance < (distances.get(next) ?? Infinity)) {
        distances.set(next, distance);
        previous.set(next, current);
      }
    }
  }
  if (start === destination) return [start];
  if (!previous.has(destination)) return [];
  const path = [destination];
  while (path[0] !== start) path.unshift(previous.get(path[0])!);
  return path;
}
function addVehicle(
  city: City,
  index: number,
  kind: City["vehicles"][number]["kind"] = "car",
  start?: string,
) {
  const node =
    city.nodes.find((n) => n.id === start) ??
    city.nodes[Math.floor(random(city) * city.nodes.length)];
  const destination = city.nodes[Math.floor(random(city) * city.nodes.length)];
  city.vehicles.push({
    id: "v-" + index,
    kind,
    path: ["ambulance", "fire", "police"].includes(kind)
      ? [node.id]
      : findPath(city, node.id, destination.id),
    progress: 0,
    speed: kind === "car" ? 26 + random(city) * 10 : kind === "bus" ? 22 : 40,
    wait: 0,
    destination: destination.id,
    dispatchAt: null,
    responseSeconds: null,
    x: node.x,
    y: node.y,
  });
}
export function createCity(seed = randomBytes(4).readUInt32LE()): City {
  const city: City = {
    id: "forge-city",
    name: "Northbank",
    label: "DIGITAL TWIN",
    width: 2240,
    height: 1600,
    revision: 0,
    seed,
    seconds: 0,
    clockMinutes: 1010,
    paused: false,
    nodes: [],
    roads: [],
    buildings: [],
    vehicles: [],
    pedestrians: [],
    hazards: [],
    weather: { rain: 0.08, wind: 0.12, direction: 0.7, cloud: 0.18 },
    grid: { capacity: 140, available: 140, baselineDemand: 120 },
    metrics: {
      exposedPeople: 0,
      evacuationSeconds: 0,
      congestion: 0,
      hospitalPower: 1,
      gridLoad: 0,
      responseSeconds: 0,
      energyDemand: 0,
      evacuatedPeople: 0,
      shelterOccupancy: 0,
    },
    events: [],
    observations: [
      {
        id: "environment",
        trust: "trusted",
        text: "Operational simulation. Actuators affect only this digital twin; no physical city connection.",
      },
    ],
  };
  for (let row = 0; row < 6; row++)
    for (let col = 0; col < 8; col++) {
      const node = {
        id: "n-" + row + "-" + col,
        x: 140 + col * 280,
        y: 130 + row * 260,
        signal: (row + col) % 2 ? ("ns" as const) : ("ew" as const),
        signalSeconds: 18,
        signalRemaining: 4 + ((row * 7 + col * 3) % 18),
      };
      city.nodes.push(node);
      for (const [nr, nc] of [
        [row, col + 1],
        [row + 1, col],
      ]) {
        if (nr >= 6 || nc >= 8) continue;
        const bridge = col === 3 && nc === 4;
        city.roads.push({
          id: "r-" + row + "-" + col + "-" + nr + "-" + nc,
          from: node.id,
          to: "n-" + nr + "-" + nc,
          length: nr === row ? 280 : 260,
          capacity: bridge ? 4 : 7,
          closed: bridge && ![1, 3, 5].includes(row),
          manualClosed: bridge && ![1, 3, 5].includes(row),
          bridge,
          risk: 0,
          floodDepth: 0,
          smoke: 0,
          damage: 0,
          load: 0,
        });
      }
    }
  const landmarks: Record<
    string,
    { kind: City["buildings"][number]["kind"]; name: string }
  > = {
    "1-1": { kind: "foundry", name: "FORGE Operations Center" },
    "1-5": { kind: "hospital", name: "Northbank Hospital" },
    "3-1": { kind: "fire", name: "Fire Station" },
    "4-5": { kind: "police", name: "Police Station" },
    "0-1": { kind: "shelter", name: "West Shelter" },
    "4-6": { kind: "shelter", name: "East Shelter" },
    "2-6": { kind: "plant", name: "Power Plant" },
    "4-0": { kind: "substation", name: "West Substation" },
    "0-5": { kind: "school", name: "North School" },
    "3-5": { kind: "transit", name: "Transit Hub" },
    "2-1": { kind: "industrial", name: "Works District" },
  };
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 7; col++) {
      if (col === 3) continue;
      const landmark = landmarks[row + "-" + col];
      const kind =
        landmark?.kind ?? ((row + col) % 3 === 0 ? "office" : "home");
      const critical = [
        "hospital",
        "fire",
        "police",
        "plant",
        "substation",
      ].includes(kind);
      city.buildings.push({
        id: "b-" + row + "-" + col,
        name:
          landmark?.name ??
          (kind === "home" ? "Residence " : "Office ") + (row * 7 + col + 1),
        kind,
        x: 192 + col * 280,
        y: 185 + row * 260,
        w: 148,
        h: 130,
        node: "n-" + row + "-" + col,
        power: 1,
        demand:
          kind === "hospital"
            ? 12
            : kind === "plant"
              ? 1
              : 2 + ((row + col) % 3),
        damage: 0,
        mode: "normal",
        critical,
        capacity: kind === "shelter" ? 50 : 0,
        occupancy: 0,
        generator: kind === "hospital",
      });
    }
  city.grid.baselineDemand = city.buildings.reduce(
    (sum, b) => sum + b.demand,
    0,
  );
  for (let i = 0; i < 52; i++)
    addVehicle(city, i, i % 13 === 0 ? "bus" : "car");
  for (const [index, kind, building] of [
    [52, "ambulance", "hospital"],
    [53, "fire", "fire"],
    [54, "police", "police"],
  ] as const)
    addVehicle(
      city,
      index,
      kind,
      city.buildings.find((b) => b.kind === building)!.node,
    );
  for (let i = 0; i < 64; i++) {
    const start = city.nodes[Math.floor(random(city) * city.nodes.length)];
    const target =
      city.buildings[Math.floor(random(city) * city.buildings.length)];
    city.pedestrians.push({
      id: "p-" + i,
      path: findPath(city, start.id, target.node),
      progress: 0,
      speed: 8 + random(city) * 4,
      destination: target.id,
      shelterId: null,
      evacuated: false,
      exposureSeconds: 0,
      x: start.x,
      y: start.y,
    });
  }
  ensureCityFields(city);
  recomputeMetrics(city);
  cityEvent(
    city,
    "Northbank digital twin online. Road graph, traffic, power and population are authoritative.",
    "simulation",
  );
  return citySchema.parse(city);
}
function position(
  city: City,
  entity: { path: string[]; progress: number; x: number; y: number },
  offset = 0,
) {
  const from = city.nodes.find((n) => n.id === entity.path[0]);
  const to = city.nodes.find((n) => n.id === entity.path[1]);
  if (!from) return;
  entity.x =
    from.x +
    ((to?.x ?? from.x) - from.x) * entity.progress +
    (to?.y !== from.y ? offset : 0);
  entity.y =
    from.y +
    ((to?.y ?? from.y) - from.y) * entity.progress +
    (to?.x !== from.x ? offset : 0);
}
export function recomputeMetrics(city: City) {
  const active = city.hazards.filter((h) => h.active);
  const exposed = city.pedestrians.filter(
    (p) =>
      !p.evacuated &&
      active.some(
        (h) =>
          Math.hypot(p.x - h.x, p.y - h.y) < h.radius && h.intensity > 0.25,
      ),
  );
  const evacuated = city.pedestrians.filter((p) => p.evacuated);
  const hospital = city.buildings.filter((b) => b.kind === "hospital");
  const demand = city.buildings.reduce((sum, b) => sum + b.demand * b.power, 0);
  const responders = city.vehicles.filter((v) => v.dispatchAt !== null);
  const incidentResponses = active.map((h) => {
    const arrived = responders.filter(
      (v) =>
        v.responseSeconds !== null &&
        Math.hypot(v.x - h.x, v.y - h.y) <= h.radius,
    );
    return arrived.length
      ? Math.min(...arrived.map((v) => v.responseSeconds!))
      : h.age;
  });
  city.metrics = {
    exposedPeople: exposed.length,
    evacuationSeconds:
      city.pedestrians.reduce((sum, p) => sum + p.exposureSeconds, 0) /
      Math.max(1, city.pedestrians.length),
    congestion:
      city.vehicles.filter((v) => v.wait > 4).length /
      Math.max(1, city.vehicles.length),
    hospitalPower:
      hospital.reduce((sum, b) => sum + b.power, 0) /
      Math.max(1, hospital.length),
    gridLoad: demand / Math.max(1, city.grid.available),
    energyDemand: demand,
    responseSeconds: incidentResponses.length
      ? incidentResponses.reduce((sum, n) => sum + n, 0) /
        incidentResponses.length
      : responders.reduce(
          (sum, v) => sum + (v.responseSeconds ?? city.seconds - v.dispatchAt!),
          0,
        ) / Math.max(1, responders.length),
    evacuatedPeople: evacuated.length,
    shelterOccupancy: city.buildings
      .filter((b) => b.kind === "shelter")
      .reduce((sum, b) => sum + b.occupancy, 0),
  };
}
export function advanceCity(city: City, seconds = 2, spontaneous = true) {
  if (city.paused) return;
  ensureCityFields(city);
  city.seconds += seconds;
  city.clockMinutes = (city.clockMinutes + seconds / 8) % 1440;
  city.revision++;
  city.weather.cloud = clamp(city.weather.cloud + (random(city) - 0.5) * 0.02);
  if (
    spontaneous &&
    city.hazards.filter((h) => h.active).length < 4 &&
    random(city) < seconds / 1600
  ) {
    const node = city.nodes[Math.floor(random(city) * city.nodes.length)];
    const kinds = ["storm", "traffic", "flood", "blackout"] as const;
    controlCity(
      city,
      {
        operation: "hazard.create",
        kind: kinds[Math.floor(random(city) * kinds.length)],
        x: node.x,
        y: node.y,
        radius: 140,
        intensity: 0.35 + random(city) * 0.3,
      },
      "simulation",
    );
  }
  for (const node of city.nodes) {
    node.signalRemaining -= seconds;
    if (node.signalRemaining <= 0) {
      node.signal = node.signal === "ns" ? "ew" : "ns";
      node.signalRemaining = node.signalSeconds;
    }
  }
  for (const hazard of city.hazards) {
    if (!hazard.active) continue;
    hazard.age += seconds;
    if (hazard.kind === "tornado") {
      hazard.x = clamp(
        hazard.x +
          Math.cos(city.weather.direction) *
            seconds *
            (6 + city.weather.wind * 10),
        0,
        city.width,
      );
      hazard.y = clamp(
        hazard.y + Math.sin(city.weather.direction) * seconds * 6,
        0,
        city.height,
      );
    }
    if (["flood", "wildfire", "storm", "gas"].includes(hazard.kind))
      hazard.radius = clamp(
        hazard.radius +
          seconds *
            (hazard.kind === "wildfire"
              ? 0.5 + city.weather.wind * 1.2 - city.weather.rain * 0.8
              : 0.25),
        20,
        650,
      );
    hazard.intensity = clamp(hazard.intensity + (random(city) - 0.48) * 0.008);
    if (hazard.age > 900) {
      hazard.intensity *= 0.995;
      if (hazard.intensity < 0.1) hazard.active = false;
    }
  }
  advanceTerrain(city, seconds);
  const nodes = new Map(city.nodes.map((n) => [n.id, n]));
  const loads = new Map<string, number>();
  for (const v of city.vehicles)
    if (v.path.length >= 2) {
      const r = roadBetween(city, v.path[0], v.path[1]);
      if (r) loads.set(r.id, (loads.get(r.id) ?? 0) + 1);
    }
  for (const road of city.roads) {
    const a = nodes.get(road.from)!;
    const b = nodes.get(road.to)!;
    let risk = 0,
      flood = 0,
      smoke = 0;
    road.baseCapacity ??= road.capacity;
    road.capacity = road.baseCapacity;
    for (const h of city.hazards.filter((h) => h.active)) {
      const distance = Math.hypot((a.x + b.x) / 2 - h.x, (a.y + b.y) / 2 - h.y);
      const influence =
        clamp(1 - distance / (h.radius + road.length * 0.35)) * h.intensity;
      if (h.kind === "flood")
        flood = Math.max(
          flood,
          influence * 1.4 + (road.bridge ? city.weather.rain * 0.12 : 0),
        );
      if (h.kind === "wildfire" || h.kind === "gas")
        smoke = Math.max(smoke, influence);
      if (h.kind === "earthquake" || h.kind === "tornado")
        road.damage = clamp(road.damage + influence * seconds * 0.012);
      if (h.kind !== "blackout") risk = Math.max(risk, influence);
      if (h.kind === "traffic")
        road.capacity = Math.max(1, road.capacity * (1 - influence * 0.85));
    }
    for (const fraction of [0.2, 0.5, 0.8]) {
      const cell = terrainAt(
        city,
        a.x + (b.x - a.x) * fraction,
        a.y + (b.y - a.y) * fraction,
      )!;
      flood = Math.max(flood, cell.water);
      smoke = Math.max(smoke, cell.smoke, cell.gas);
      road.damage = Math.max(road.damage, cell.damage);
    }
    road.floodDepth = flood;
    road.smoke = smoke;
    road.risk = clamp(Math.max(risk, flood / 1.2, smoke, road.damage));
    road.closed = road.manualClosed || flood > 0.7 || road.damage > 0.6;
    road.load = loads.get(road.id) ?? 0;
  }
  const blackout = city.hazards
    .filter((h) => h.active && h.kind === "blackout")
    .reduce((sum, h) => sum + h.intensity * 0.22, 0);
  const plants = city.buildings.filter(
    (b) => b.kind === "plant" || b.kind === "substation",
  );
  city.grid.available =
    city.grid.capacity *
    clamp(
      1 - blackout - plants.reduce((sum, b) => sum + b.damage * 0.15, 0),
      0.1,
      1,
    );
  for (const building of city.buildings) {
    for (const h of city.hazards.filter(
      (h) => h.active && ["earthquake", "tornado", "wildfire"].includes(h.kind),
    )) {
      const influence =
        clamp(
          1 -
            Math.hypot(
              building.x + building.w / 2 - h.x,
              building.y + building.h / 2 - h.y,
            ) /
              h.radius,
        ) * h.intensity;
      building.damage = clamp(building.damage + influence * seconds * 0.002);
    }
  }
  advanceGridAndDemand(city, seconds);
  const requested = city.buildings.reduce(
    (sum, b) => sum + b.power * b.demand,
    0,
  );
  const shortage = Math.max(0, requested - city.grid.available);
  if (shortage > 0) {
    const noncritical = city.buildings.filter(
      (b) => !b.critical && b.power > 0,
    );
    const noncriticalDemand = noncritical.reduce(
      (sum, b) => sum + b.power * b.demand,
      0,
    );
    for (const b of noncritical)
      b.power *= clamp(1 - shortage / Math.max(1, noncriticalDemand));
  }
  for (const vehicle of city.vehicles) {
    if (vehicle.path.length < 2) {
      if (
        vehicle.dispatchAt === null &&
        ["ambulance", "fire", "police"].includes(vehicle.kind)
      )
        continue;
      if (vehicle.dispatchAt !== null) {
        vehicle.responseSeconds ??= city.seconds - vehicle.dispatchAt;
        continue;
      }
      const target = city.nodes[Math.floor(random(city) * city.nodes.length)];
      vehicle.destination = target.id;
      vehicle.path = findPath(
        city,
        vehicle.path[0] ?? city.nodes[0].id,
        target.id,
      );
      vehicle.progress = 0;
    }
    const road =
      vehicle.path.length > 1
        ? roadBetween(city, vehicle.path[0], vehicle.path[1])
        : undefined;
    const from = city.nodes.find((n) => n.id === vehicle.path[0]);
    const to = city.nodes.find((n) => n.id === vehicle.path[1]);
    if (!road || !from || !to) continue;
    const ns = Math.abs(to.y - from.y) > 0;
    const signalStop =
      vehicle.progress < 0.08 &&
      from.powered !== false &&
      from.signal !== "emergency" &&
      from.signal !== (ns ? "ns" : "ew");
    if (road.closed || signalStop || road.load > road.capacity * 1.6) {
      vehicle.wait += seconds;
      if (road.closed && vehicle.progress < 0.05) {
        const alternative = findPath(city, from.id, vehicle.destination);
        if (alternative.length) {
          vehicle.path = alternative;
          vehicle.progress = 0;
        }
      }
    } else {
      vehicle.wait = Math.max(0, vehicle.wait - seconds);
      vehicle.progress +=
        (seconds * vehicle.speed) /
        road.length /
        (1 + (road.load / road.capacity) * 0.55 + road.risk * 2);
      if (vehicle.progress >= 1) {
        vehicle.path.shift();
        vehicle.progress = 0;
      }
    }
    position(city, vehicle, 8);
  }
  for (const pedestrian of city.pedestrians) {
    if (pedestrian.evacuated) continue;
    if (
      city.hazards.some(
        (h) =>
          h.active &&
          h.intensity > 0.25 &&
          Math.hypot(pedestrian.x - h.x, pedestrian.y - h.y) < h.radius,
      )
    )
      pedestrian.exposureSeconds += seconds;
    const road =
      pedestrian.path.length > 1
        ? roadBetween(city, pedestrian.path[0], pedestrian.path[1])
        : undefined;
    if (road && !road.closed && road.risk < 0.8) {
      pedestrian.progress += (seconds * pedestrian.speed) / road.length;
      if (pedestrian.progress >= 1) {
        pedestrian.path.shift();
        pedestrian.progress = 0;
      }
    }
    position(city, pedestrian, -22);
    if (pedestrian.path.length <= 1) {
      const shelter = city.buildings.find((b) => b.id === pedestrian.shelterId);
      if (
        shelter &&
        shelter.mode === "emergency" &&
        shelter.occupancy < shelter.capacity &&
        shelter.damage < 0.6
      ) {
        pedestrian.evacuated = true;
        shelter.occupancy++;
      } else if (!shelter) {
        const target =
          city.buildings[Math.floor(random(city) * city.buildings.length)];
        pedestrian.destination = target.id;
        pedestrian.path = findPath(
          city,
          pedestrian.path[0] ?? city.nodes[0].id,
          target.node,
        );
      }
    }
  }
  recomputeMetrics(city);
  if (
    city.deployment &&
    !city.deployment.degraded &&
    (city.metrics.hospitalPower < 0.9 ||
      city.metrics.exposedPeople > 8 ||
      city.metrics.congestion > 0.65)
  ) {
    city.deployment.degraded = true;
    city.deployment.degradation =
      "Observed objectives deteriorated: exposure " +
      city.metrics.exposedPeople +
      ", congestion " +
      city.metrics.congestion.toFixed(2) +
      ", hospital power " +
      city.metrics.hospitalPower.toFixed(2) +
      ". Review adaptation before granting another version authority.";
  }
}
export function controlCity(
  city: City,
  raw: SimulationControl,
  origin: "human" | "simulation" = "human",
) {
  const change = simulationControlSchema.parse(raw);
  if (change.operation === "hazard.create") {
    if (city.hazards.length >= 16)
      city.hazards = city.hazards.filter((h) => h.active).slice(-15);
    city.hazards.push({
      id: "h-" + city.revision + "-" + city.hazards.length,
      kind: change.kind,
      x: change.x,
      y: change.y,
      radius: change.radius,
      intensity: change.intensity,
      age: 0,
      active: true,
    });
    if (change.kind === "storm") {
      city.weather.rain = Math.max(city.weather.rain, change.intensity);
      city.weather.wind = Math.max(city.weather.wind, change.intensity * 0.75);
      city.weather.cloud = Math.max(
        city.weather.cloud,
        0.6 + change.intensity * 0.4,
      );
    }
  } else if (change.operation === "road.toggle") {
    const road = city.roads.find((r) => r.id === change.roadId);
    if (!road) throw new Error("Unknown road");
    road.manualClosed = !road.manualClosed;
    road.closed = road.manualClosed || road.risk >= 0.65;
  } else if (change.operation === "building.damage") {
    const building = city.buildings.find((b) => b.id === change.buildingId);
    if (!building) throw new Error("Unknown building");
    building.damage = change.damage;
  } else if (change.operation === "weather.set") {
    city.weather.rain = change.rain;
    city.weather.wind = change.wind;
    city.weather.cloud = Math.max(city.weather.cloud, change.rain);
  } else if (change.operation === "traffic.add") {
    for (let i = 0; i < change.count && city.vehicles.length < 120; i++)
      addVehicle(city, city.vehicles.length);
  } else if (change.operation === "pause") city.paused = change.paused;
  else {
    city.observations.push({
      id: "untrusted-" + city.revision,
      trust: "untrusted",
      text: change.text,
    });
    city.observations = city.observations.slice(-12);
  }
  city.revision++;
  if (
    city.deployment &&
    change.operation !== "pause" &&
    change.operation !== "sensor.inject"
  ) {
    city.deployment.degraded = true;
    city.deployment.degradation =
      "Environment changed after approval: " +
      change.operation +
      ". Adaptation requires new local Futures evidence and owner approval.";
  }
  cityEvent(
    city,
    "Environment change: " +
      change.operation +
      (change.operation === "hazard.create" ? " / " + change.kind : ""),
    origin,
  );
  recomputeMetrics(city);
}
export function applyCityAction(city: City, action: CityAction) {
  if (action.operation === "road.close" || action.operation === "road.open") {
    const road = city.roads.find((r) => r.id === action.roadId);
    if (!road) throw new Error("Unknown road actuator");
    if (
      action.operation === "road.open" &&
      (road.risk >= 0.65 || road.damage > 0.6 || road.floodDepth > 0.7)
    )
      throw new Error("Hard safety gate: reopening hazardous road denied");
    road.manualClosed = action.operation === "road.close";
    road.closed = road.manualClosed;
  } else if (action.operation === "signal.set") {
    const node = city.nodes.find((n) => n.id === action.nodeId);
    if (!node) throw new Error("Unknown signal");
    node.signal = action.phase;
    node.signalSeconds = action.seconds;
    node.signalRemaining = action.seconds;
  } else if (
    action.operation === "vehicle.route" ||
    action.operation === "vehicle.dispatch"
  ) {
    const vehicle = city.vehicles.find((v) => v.id === action.vehicleId);
    if (!vehicle) throw new Error("Unknown vehicle");
    const target =
      action.operation === "vehicle.dispatch"
        ? (city.buildings.find((b) => b.id === action.destination)?.node ??
          action.destination)
        : action.path.at(-1)!;
    const path =
      action.operation === "vehicle.route"
        ? action.path
        : findPath(city, vehicle.path[0] ?? city.nodes[0].id, target);
    if (path.length < 1 || path[0] !== vehicle.path[0])
      throw new Error("Route must start at current vehicle node");
    for (let i = 1; i < path.length; i++) {
      const road = roadBetween(city, path[i - 1], path[i]);
      if (!road || road.closed || road.risk >= 0.65)
        throw new Error(
          "Hard safety gate: unsafe or disconnected vehicle route",
        );
    }
    if (
      action.operation === "vehicle.dispatch" &&
      !["ambulance", "fire", "police"].includes(vehicle.kind)
    )
      throw new Error("Only responder vehicles can be dispatched");
    vehicle.path = path;
    vehicle.destination = target;
    vehicle.progress = 0;
    if (action.operation === "vehicle.dispatch") {
      vehicle.dispatchAt = city.seconds;
      vehicle.responseSeconds = null;
    }
  } else if (action.operation === "population.route") {
    const pedestrian = city.pedestrians.find(
      (p) => p.id === action.pedestrianId,
    );
    const shelter = city.buildings.find(
      (b) => b.id === action.shelterId && b.kind === "shelter",
    );
    if (
      !pedestrian ||
      !shelter ||
      shelter.mode !== "emergency" ||
      shelter.damage > 0.6
    )
      throw new Error("Shelter unavailable");
    const reservations = city.pedestrians.filter(
      (p) => p.shelterId === shelter.id && !p.evacuated,
    ).length;
    if (
      shelter.occupancy + reservations >= shelter.capacity &&
      pedestrian.shelterId !== shelter.id
    )
      throw new Error("Hard safety gate: shelter capacity");
    const path = findPath(
      city,
      pedestrian.path[0] ?? city.nodes[0].id,
      shelter.node,
    );
    if (!path.length) throw new Error("No safe evacuation path");
    pedestrian.path = path;
    pedestrian.progress = 0;
    pedestrian.destination = shelter.id;
    pedestrian.shelterId = shelter.id;
  } else if (action.operation === "alert.broadcast") {
    cityEvent(city, action.message, "capability");
  } else {
    const building = city.buildings.find((b) => b.id === action.buildingId);
    if (!building) throw new Error("Unknown building actuator");
    if (
      action.operation === "grid.allocate" ||
      action.operation === "grid.shed"
    ) {
      if (building.critical && action.power < 0.9)
        throw new Error(
          "Hard safety gate: critical infrastructure power floor",
        );
      const demand =
        city.buildings.reduce((sum, b) => sum + b.power * b.demand, 0) +
        (action.power - building.power) * building.demand;
      if (demand > city.grid.available + 0.001 && action.power > building.power)
        throw new Error("Hard safety gate: grid capacity");
      building.power = action.power;
      building.requestedPower = action.power;
    } else if (action.operation === "building.mode") {
      if (building.critical && action.mode === "closed")
        throw new Error("Hard safety gate: critical infrastructure closure");
      building.mode = action.mode;
    } else {
      if (building.kind !== "shelter" || building.damage > 0.6)
        throw new Error("Shelter unavailable");
      building.mode = "emergency";
    }
  }
  city.revision++;
  recomputeMetrics(city);
}
export function violations(city: City, goal: GoalContract): string[] {
  return goal.hard
    .filter((c) =>
      c.operator === "lte"
        ? city.metrics[c.metric] > c.value
        : city.metrics[c.metric] < c.value,
    )
    .map(
      (c) =>
        c.metric +
        " " +
        c.operator +
        " " +
        c.value +
        " (observed " +
        city.metrics[c.metric].toFixed(3) +
        ")",
    );
}
const metricScale: Record<keyof CityMetrics, number> = {
  exposedPeople: 64,
  evacuationSeconds: 120,
  congestion: 1,
  hospitalPower: 1,
  gridLoad: 1,
  responseSeconds: 120,
  energyDemand: 140,
  evacuatedPeople: 64,
  shelterOccupancy: 100,
};
export function objectiveScore(metrics: CityMetrics, goal: GoalContract) {
  return (
    goal.objectives.reduce(
      (sum, objective) =>
        sum +
        ((objective.weight * metrics[objective.metric]) /
          metricScale[objective.metric]) *
          (objective.direction === "minimize" ? 1 : -1),
      0,
    ) / goal.objectives.reduce((sum, o) => sum + o.weight, 0)
  );
}
export function futureFrame(city: City): FutureFrame {
  return {
    terrain: city.terrain ? structuredClone(city.terrain) : undefined,
    nodes: structuredClone(city.nodes),
    roads: city.roads.map(({ id, closed, risk, load }) => ({
      id,
      closed,
      risk,
      load,
    })),
    buildings: city.buildings.map(({ id, power, damage, mode, occupancy }) => ({
      id,
      power,
      damage,
      mode,
      occupancy,
    })),
    weather: structuredClone(city.weather),
    clockMinutes: city.clockMinutes,
    seconds: city.seconds,
    metrics: structuredClone(city.metrics),
    vehicles: city.vehicles
      .slice(0, 18)
      .map(({ id, kind, x, y }) => ({ id, kind, x, y })),
    pedestrians: city.pedestrians
      .slice(0, 18)
      .map(({ id, x, y, evacuated }) => ({ id, x, y, evacuated })),
    hazards: structuredClone(city.hazards),
  };
}
