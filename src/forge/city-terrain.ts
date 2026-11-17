import type { City } from "./city-contracts";
import { createPlayer } from "./city-player";
const clip = (n: number, hi = 1) => Math.min(hi, Math.max(0, n));

/** Seeded physical fields, rather than renderer-only disaster circles. */
export function ensureCityFields(city: City) {
  city.player ??= createPlayer();
  city.terrain ??= {
    cellSize: 80,
    cols: 28,
    rows: 20,
    cells: Array.from({ length: 560 }, (_, i) => {
      const x = ((i % 28) + 0.5) * 80,
        y = (Math.floor(i / 28) + 0.5) * 80;
      const variation =
        Math.sin(x * 0.011 + (city.seed % 31)) * Math.cos(y * 0.009);
      return {
        elevation: clip(Math.abs(x - 1120) / 1600 + variation * 0.06),
        fuel: clip(0.45 + variation * 0.3),
        water: 0,
        fire: 0,
        smoke: 0,
        gas: 0,
        damage: 0,
      };
    }),
  };
  if (!city.gridNodes) {
    const plant = city.buildings.find((b) => b.kind === "plant")!;
    const substations = city.buildings.filter((b) => b.kind === "substation");
    city.gridNodes = city.buildings.map((b) => ({
      id: "g-" + b.id,
      buildingId: b.id,
      parent:
        b.id === plant.id
          ? null
          : b.kind === "substation"
            ? "g-" + plant.id
            : "g-" +
              (substations.reduce(
                (best, s) =>
                  Math.hypot(s.x - b.x, s.y - b.y) <
                  Math.hypot(best.x - b.x, best.y - b.y)
                    ? s
                    : best,
                substations[0],
              )?.id ?? plant.id),
      capacity:
        b.kind === "plant"
          ? city.grid.capacity
          : b.kind === "substation"
            ? 100
            : b.demand * 1.35,
      load: b.demand,
      voltage: b.power,
      failed: false,
      overloadSeconds: 0,
    }));
  }
  for (const b of city.buildings) b.requestedPower ??= b.power;
}
export function terrainAt(city: City, x: number, y: number) {
  return city.terrain?.cells[
    Math.min(19, Math.max(0, Math.floor(y / 80))) * 28 +
      Math.min(27, Math.max(0, Math.floor(x / 80)))
  ];
}
export function advanceTerrain(city: City, seconds: number) {
  ensureCityFields(city);
  const terrain = city.terrain!;
  const active = city.hazards.filter((h) => h.active);
  const steps = Math.ceil(seconds / 2),
    dt = seconds / steps;
  for (let step = 0; step < steps; step++) {
    const previous = terrain.cells.map((c) => ({ ...c }));
    for (let i = 0; i < terrain.cells.length; i++) {
      const cell = terrain.cells[i],
        col = i % 28,
        row = Math.floor(i / 28),
        x = (col + 0.5) * 80,
        y = (row + 0.5) * 80;
      const neighbors = [
        col ? i - 1 : -1,
        col < 27 ? i + 1 : -1,
        row ? i - 28 : -1,
        row < 19 ? i + 28 : -1,
      ].filter((n) => n >= 0);
      let waterIn = 0,
        ignition = 0,
        smokeIn = 0,
        gasIn = 0;
      for (const n of neighbors) {
        const other = previous[n],
          nx = (n % 28) - col,
          ny = Math.floor(n / 28) - row;
        const upstream = clip(
          0.25 -
            (nx * Math.cos(city.weather.direction) +
              ny * Math.sin(city.weather.direction)) *
              city.weather.wind *
              0.35,
          0.7,
        );
        waterIn +=
          Math.max(
            0,
            other.water +
              (other.elevation - cell.elevation) * 0.5 -
              previous[i].water,
          ) * 0.035;
        ignition += other.fire * upstream * 0.025;
        smokeIn += other.smoke * upstream * 0.02;
        gasIn += other.gas * upstream * 0.018;
      }
      cell.water = clip(
        previous[i].water +
          dt *
            (waterIn - previous[i].water * 0.013 + city.weather.rain * 0.0015),
        3,
      );
      cell.fire = clip(
        previous[i].fire +
          dt *
            (ignition * cell.fuel -
              previous[i].fire *
                (0.006 + city.weather.rain * 0.028 + cell.water * 0.05)),
      );
      cell.smoke = clip(
        previous[i].smoke +
          dt * (smokeIn + cell.fire * 0.018 - previous[i].smoke * 0.018),
      );
      cell.gas = clip(previous[i].gas + dt * (gasIn - previous[i].gas * 0.018));
      for (const h of active) {
        const dx = x - h.x,
          dy = y - h.y,
          distance = Math.hypot(dx, dy);
        const reach =
          h.kind === "gas"
            ? h.radius * (1 + city.weather.wind * 1.5)
            : h.radius;
        const downwind =
          h.kind === "gas"
            ? clip(
                0.6 +
                  ((dx * Math.cos(city.weather.direction) +
                    dy * Math.sin(city.weather.direction)) /
                    Math.max(80, reach)) *
                    0.8,
              )
            : 1;
        const effect = clip(1 - distance / reach) * h.intensity;
        if (h.kind === "flood")
          cell.water = clip(
            cell.water + dt * effect * 0.013 * (1 - cell.elevation * 0.6),
            3,
          );
        if (h.kind === "storm")
          cell.water = clip(cell.water + dt * effect * 0.0025, 3);
        if (h.kind === "wildfire")
          cell.fire = clip(cell.fire + dt * effect * cell.fuel * 0.022);
        if (h.kind === "gas")
          cell.gas = clip(cell.gas + dt * effect * downwind * 0.02);
        if (h.kind === "earthquake" || h.kind === "tornado")
          cell.damage = clip(
            cell.damage +
              effect *
                dt *
                (h.kind === "earthquake" && h.age > 24 ? 0.0005 : 0.01),
          );
      }
      cell.fuel = clip(cell.fuel - cell.fire * dt * 0.0015);
      cell.damage = clip(cell.damage + dt * cell.fire * 0.002);
    }
  }
}
export function advanceGridAndDemand(city: City, seconds: number) {
  const active = city.hazards.filter((h) => h.active);
  const byBuilding = new Map(city.buildings.map((b) => [b.id, b]));
  const byGrid = new Map(city.gridNodes!.map((n) => [n.id, n]));
  for (const n of city.gridNodes!) {
    const b = byBuilding.get(n.buildingId)!;
    const field = terrainAt(city, b.x + b.w / 2, b.y + b.h / 2)!;
    b.damage = clip(
      Math.max(b.damage, field.damage * 0.85) + field.fire * seconds * 0.0008,
    );
    const blackout = active
      .filter((h) => h.kind === "blackout")
      .reduce(
        (risk, h) =>
          Math.max(
            risk,
            clip(1 - Math.hypot(b.x - h.x, b.y - h.y) / (h.radius * 1.8)) *
              h.intensity,
          ),
        0,
      );
    n.load =
      b.demand *
      (1 +
        field.fire * 0.4 +
        field.water * 0.18 +
        (b.kind === "hospital" ? city.metrics.exposedPeople / 90 : 0));
    n.overloadSeconds =
      n.load > n.capacity
        ? n.overloadSeconds + seconds
        : Math.max(0, n.overloadSeconds - seconds * 2);
    n.failed =
      b.damage > 0.78 ||
      field.water > 1.1 ||
      blackout > 0.75 ||
      n.overloadSeconds > 40;
    n.voltage = n.failed
      ? 0
      : clip(1 - blackout * 0.55 - b.damage * 0.2 - field.water * 0.08);
  }
  // Upstream failures propagate; a generator is local and can itself be damaged.
  for (let pass = 0; pass < 3; pass++)
    for (const n of city.gridNodes!) {
      if (n.parent)
        n.voltage = Math.min(n.voltage, byGrid.get(n.parent)?.voltage ?? 1);
    }
  for (const n of city.gridNodes!) {
    const b = byBuilding.get(n.buildingId)!;
    b.generatorActive = b.generator && n.voltage < 0.9 && b.damage < 0.85;
    b.power = clip(
      (b.requestedPower ?? 1) * (b.generatorActive ? 1 : n.voltage),
    );
    b.emergencyLoad = clip(
      0.12 +
        city.metrics.exposedPeople / 65 +
        city.metrics.responseSeconds / 450,
    );
    b.bedLoad = clip(
      0.35 +
        city.metrics.exposedPeople / 90 +
        city.metrics.evacuationSeconds / 700,
    );
  }
  for (const node of city.nodes) {
    const nearby = city.buildings.filter((b) => b.node === node.id);
    node.powered = nearby.length
      ? nearby.some(
          (b) =>
            city.gridNodes!.find((g) => g.buildingId === b.id)!.voltage > 0.4,
        )
      : city.gridNodes!.some((n) => n.voltage > 0.4);
  }
}
