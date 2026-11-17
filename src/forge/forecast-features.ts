import type { City } from "./city-contracts";
import { terrainAt } from "./city-terrain";
export const forecastTargets = [
  "queue",
  "delay",
  "congestion",
  "water",
  "fire",
  "smoke",
  "power",
  "hospitalDemand",
  "emergencyDemand",
] as const;
export const observedFeatures = [
  ...forecastTargets,
  "passable",
  "gridLoad",
  "capacity",
  "damage",
  "gas",
  "fuel",
  "rain",
  "wind",
  "windX",
  "windY",
  "cloud",
  "vehicles",
  "population",
  "critical",
  "hospital",
  "generator",
  "hazardCount",
  "maxIntensity",
  "closedRoads",
  "timeSin",
  "timeCos",
] as const;
export const featureNames = [
  ...observedFeatures.map((n) => "current." + n),
  ...observedFeatures.map((n) => "lag10." + n),
  ...observedFeatures.map((n) => "lag20." + n),
  ...observedFeatures.slice(0, 15).map((n) => "roadNeighbors." + n),
  ...observedFeatures.slice(0, 15).map((n) => "gridParent." + n),
  "horizon",
];
/** Only observations at or before the prediction origin; seeds/IDs never enter X. */
export function observeForecastNodes(city: City): number[][] {
  return city.nodes.map((node) => {
    const adjacent = city.roads.filter(
      (r) => r.from === node.id || r.to === node.id,
    );
    const vehicles = city.vehicles.filter((v) => v.path[0] === node.id);
    const waiting = vehicles.filter((v) => v.wait > 0);
    const building = city.buildings.find((b) => b.node === node.id);
    const cell = terrainAt(city, node.x, node.y);
    const nearPeople = city.pedestrians.filter(
      (p) => !p.evacuated && Math.hypot(p.x - node.x, p.y - node.y) < 240,
    );
    const nearHazards = city.hazards.filter(
      (h) =>
        h.active && Math.hypot(h.x - node.x, h.y - node.y) < h.radius + 240,
    );
    const grid = city.gridNodes?.find((g) => g.buildingId === building?.id);
    const water = Math.max(
      cell?.water ?? 0,
      ...adjacent.map((r) => r.floodDepth),
    );
    const smoke = Math.max(cell?.smoke ?? 0, ...adjacent.map((r) => r.smoke));
    const demand = nearPeople.filter((p) =>
      city.hazards.some(
        (h) => h.active && Math.hypot(p.x - h.x, p.y - h.y) < h.radius,
      ),
    ).length;
    // This value is observed hospital occupancy pressure, not a synthetic label.
    const hospitalDemand =
      building?.kind === "hospital" ? (building.bedLoad ?? 0) : 0;
    const congestion =
      adjacent.reduce((s, r) => s + r.load / r.capacity, 0) /
      Math.max(1, adjacent.length);
    return [
      waiting.length,
      waiting.reduce((s, v) => s + v.wait, 0) / Math.max(1, waiting.length),
      congestion,
      water,
      cell?.fire ?? 0,
      smoke,
      building?.power ?? (node.powered === false ? 0 : 1),
      hospitalDemand,
      demand,
      adjacent.some(
        (r) =>
          (r.closed && !r.manualClosed) || r.floodDepth > 0.7 || r.damage > 0.6,
      )
        ? 0
        : 1,
      grid ? grid.load / grid.capacity : city.metrics.gridLoad,
      grid?.capacity ?? 0,
      Math.max(building?.damage ?? 0, cell?.damage ?? 0),
      cell?.gas ?? 0,
      cell?.fuel ?? 0,
      city.weather.rain,
      city.weather.wind,
      Math.cos(city.weather.direction),
      Math.sin(city.weather.direction),
      city.weather.cloud,
      city.vehicles.length,
      nearPeople.length,
      building?.critical ? 1 : 0,
      building?.kind === "hospital" ? 1 : 0,
      building?.generatorActive ? 1 : 0,
      nearHazards.length,
      Math.max(0, ...nearHazards.map((h) => h.intensity)),
      city.roads.filter((r) => r.closed).length,
      Math.sin((city.clockMinutes / 1440) * Math.PI * 2),
      Math.cos((city.clockMinutes / 1440) * Math.PI * 2),
    ];
  });
}
export function forecastFeatures(
  city: City,
  observations: number[][],
  lag10: number[][],
  lag20: number[][],
  nodeIndex: number,
  horizon: number,
) {
  const node = city.nodes[nodeIndex];
  const neighbors = city.roads
    .filter((r) => r.from === node.id || r.to === node.id)
    .map((r) =>
      city.nodes.findIndex(
        (n) => n.id === (r.from === node.id ? r.to : r.from),
      ),
    );
  const mean = Array.from(
    { length: 15 },
    (_, j) =>
      neighbors.reduce((s, i) => s + observations[i][j], 0) /
      Math.max(1, neighbors.length),
  );
  const building = city.buildings.find((b) => b.node === node.id);
  const grid = city.gridNodes?.find((g) => g.buildingId === building?.id);
  const parent = city.gridNodes?.find((g) => g.id === grid?.parent);
  const parentBuilding = city.buildings.find(
    (b) => b.id === parent?.buildingId,
  );
  const parentIndex = city.nodes.findIndex(
    (n) => n.id === parentBuilding?.node,
  );
  const parentFeatures =
    parentIndex >= 0
      ? observations[parentIndex].slice(0, 15)
      : observations[nodeIndex].slice(0, 15);
  return [
    ...observations[nodeIndex],
    ...lag10[nodeIndex],
    ...lag20[nodeIndex],
    ...mean,
    ...parentFeatures,
    horizon / 120,
  ];
}
