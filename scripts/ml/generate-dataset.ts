import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import {
  createCity,
  advanceCity,
  controlCity,
  applyCityAction,
} from "../../src/forge/city-engine";
import {
  observeForecastNodes,
  forecastFeatures,
  featureNames,
  forecastTargets,
} from "../../src/forge/forecast-features";
import { hazardKinds, type City } from "../../src/forge/city-contracts";
const directory = "artifacts/ml";
await mkdir(directory, { recursive: true });
const config = {
  version: 2,
  engine: "city-fields-v2",
  episodes: 640,
  dtSeconds: 2,
  episodeSeconds: 270,
  origins: [30, 90, 150],
  horizons: [30, 60, 120],
  splitCounts: {
    train: 384,
    validation: 80,
    heldout: 80,
    shift: 48,
    compositional: 48,
  },
  features: featureNames,
  targets: forecastTargets,
  seedBase: 9310000,
  spontaneous: false,
};
const output = createWriteStream(directory + "/episodes.jsonl.gz");
const gzip = createGzip({ level: 6 });
gzip.pipe(output);
const hash = createHash("sha256");
const episodes: {
  id: string;
  seed: number;
  split: string;
  scenario: string;
  policy: string;
  rows: number;
}[] = [];
const kinds = [
  ...hazardKinds,
  "normal",
  "rush",
  "light",
  "road-closure",
  "bridge-loss",
  "grid-failure",
];
const physicalSources = [
  "src/forge/city-engine.ts",
  "src/forge/city-terrain.ts",
  "src/forge/forecast-features.ts",
];
const sourceHash = async () =>
  createHash("sha256")
    .update(
      (await Promise.all(physicalSources.map((p) => readFile(p, "utf8")))).join(
        "\n",
      ),
    )
    .digest("hex");
const engineHash = await sourceHash();
const started = performance.now();
for (const [split, count] of Object.entries(config.splitCounts)) {
  for (let e = 0; e < count; e++) {
    const index = episodes.length,
      seed = config.seedBase + index * 7919,
      city = createCity(seed);
    const scenario =
      split === "compositional"
        ? [
            "flood+blackout",
            "wildfire+gas",
            "earthquake+storm",
            "tornado+traffic",
          ][e % 4]
        : kinds[e % kinds.length];
    const intensity = split === "shift" ? 0.95 : 0.35 + (e % 6) * 0.08;
    if (scenario === "light")
      city.vehicles = city.vehicles.filter(
        (v) => v.kind !== "car" || Number(v.id.slice(2)) % 3 === 0,
      );
    if (scenario === "rush" || split === "shift")
      for (let k = 0; k < (split === "shift" ? 3 : 2); k++)
        controlCity(city, { operation: "traffic.add", count: 25 });
    const policy =
      e % 3 === 0 ? "no-policy" : e % 3 === 1 ? "risk-routing" : "grid-shelter";
    const domainRandomized = e % 4 < 2;
    if (domainRandomized) {
      city.weather.direction = (e * 0.73) % (Math.PI * 2);
      city.weather.wind = 0.05 + (e % 7) * 0.055;
      for (const v of city.vehicles) v.speed *= 0.8 + (e % 5) * 0.1;
      for (const r of city.roads)
        r.baseCapacity = r.capacity *= 0.85 + (e % 4) * 0.1;
    }
    if (split === "shift")
      for (const n of city.nodes) {
        n.x = Math.max(30, Math.min(2200, n.x + Math.sin(e + n.x) * 23));
        n.y = Math.max(30, Math.min(1570, n.y + Math.cos(e + n.y) * 20));
      }
    const states = new Map<number, number[][]>();
    const originFeatures = new Map<number, number[][][]>();
    const rows: {
      origin: number;
      horizon: number;
      node: string;
      x: number[];
      y: number[];
      outage: number;
      blocked: number;
    }[] = [];
    for (let t = 0; t <= config.episodeSeconds; t += config.dtSeconds) {
      if (t === 12 && scenario === "road-closure")
        for (const r of city.roads
          .filter((r) => !r.closed)
          .filter((_, i) => i % 11 === 0))
          controlCity(city, { operation: "road.toggle", roadId: r.id });
      if (t === 12 && scenario === "bridge-loss")
        for (const r of city.roads.filter((r) => r.bridge && !r.closed))
          controlCity(city, { operation: "road.toggle", roadId: r.id });
      if (scenario === "grid-failure" && [12, 40].includes(t)) {
        const b = city.buildings.find(
          (b) => b.kind === (e % 2 ? "plant" : "substation"),
        )!;
        controlCity(city, {
          operation: "building.damage",
          buildingId: b.id,
          damage: t === 12 ? 0.5 + (e % 3) * 0.1 : 0.8 + (e % 2) * 0.1,
        });
      }
      if (t === 12)
        for (const kind of scenario.split("+"))
          if (hazardKinds.includes(kind as (typeof hazardKinds)[number])) {
            const node =
              city.nodes[(e * 7 + Math.floor(seed / 7919)) % city.nodes.length];
            controlCity(city, {
              operation: "hazard.create",
              kind: kind as (typeof hazardKinds)[number],
              x: node.x,
              y: node.y,
              intensity,
              radius: split === "shift" ? 420 : 180 + (e % 4) * 50,
            });
            if (kind === "storm")
              controlCity(city, {
                operation: "weather.set",
                rain: intensity,
                wind: intensity * 0.8,
              });
          }
      if (split === "shift" && t === 40) {
        const b = city.buildings[(e * 3) % city.buildings.length];
        controlCity(city, {
          operation: "building.damage",
          buildingId: b.id,
          damage: 0.9,
        });
      }
      if (t % 40 === 0 && t > 0) applyBaseline(city, policy);
      const observed = observeForecastNodes(city);
      states.set(t, observed);
      if (config.origins.includes(t))
        originFeatures.set(
          t,
          config.horizons.map((h) =>
            city.nodes.map((_, i) =>
              forecastFeatures(
                city,
                observed,
                states.get(t - 10)!,
                states.get(t - 20)!,
                i,
                h,
              ),
            ),
          ),
        );
      for (const origin of config.origins)
        for (const [hindex, horizon] of config.horizons.entries())
          if (t === origin + horizon) {
            for (let i = 0; i < city.nodes.length; i++)
              rows.push({
                origin,
                horizon,
                node: city.nodes[i].id,
                x: originFeatures.get(origin)![hindex][i],
                y: observed[i].slice(0, 9),
                outage: (() => {
                  const b = city.buildings.find(
                    (b) => b.node === city.nodes[i].id,
                  );
                  const g = city.gridNodes!.find((g) => g.buildingId === b?.id);
                  return g && g.voltage < 0.5 && !b?.generatorActive ? 1 : 0;
                })(),
                blocked: observed[i][9] === 0 ? 1 : 0,
              });
          }
      if (t < config.episodeSeconds) advanceCity(city, config.dtSeconds, false);
    }
    const metadata = {
      id: "episode-" + index,
      seed,
      split,
      scenario,
      policy,
      rows: rows.length,
    };
    const text =
      JSON.stringify({
        ...metadata,
        domainRandomized,
        observations: states.size,
        rows,
      }) + "\n";
    hash.update(text);
    if (!gzip.write(text)) await once(gzip, "drain");
    episodes.push(metadata);
    if (index % 32 === 0)
      process.stdout.write(
        "Generated " + index + "/" + config.episodes + " episodes\n",
      );
  }
}
gzip.end();
await once(output, "close");
if ((await sourceHash()) !== engineHash)
  throw new Error(
    "Physical source changed during dataset generation; discard this run and regenerate",
  );
const datasetHash = hash.digest("hex");
const splitHash = createHash("sha256")
  .update(JSON.stringify(episodes.map((e) => [e.id, e.seed, e.split])))
  .digest("hex");
await writeFile(
  directory + "/dataset.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      config,
      engineHash,
      datasetHash,
      splitHash,
      totalTransitions:
        episodes.length * (config.episodeSeconds / config.dtSeconds),
      totalRows: episodes.reduce((s, e) => s + e.rows, 0),
      durationSeconds: (performance.now() - started) / 1000,
      episodes,
    },
    null,
    2,
  ),
);
console.log(
  "Dataset complete: " + episodes.length + " episodes, " + datasetHash,
);
function applyBaseline(city: City, policy: string) {
  if (policy === "no-policy") return;
  for (const road of city.roads)
    if (road.risk >= 0.5)
      applyCityAction(city, { operation: "road.close", roadId: road.id });
  if (policy === "grid-shelter") {
    for (const b of city.buildings) {
      if (!b.critical && b.power > 0.4)
        applyCityAction(city, {
          operation: "grid.shed",
          buildingId: b.id,
          power: 0.4,
        });
      if (b.kind === "shelter" && b.damage < 0.6)
        applyCityAction(city, {
          operation: "shelter.activate",
          buildingId: b.id,
        });
    }
  } else
    for (const n of city.nodes) {
      const ns = city.vehicles.filter(
        (v) =>
          v.path[0] === n.id &&
          v.wait > 0 &&
          v.path[1] &&
          city.nodes.find((n0) => n0.id === v.path[1])?.y !== n.y,
      ).length;
      const ew =
        city.vehicles.filter((v) => v.path[0] === n.id && v.wait > 0).length -
        ns;
      if (ns + ew > 1)
        applyCityAction(city, {
          operation: "signal.set",
          nodeId: n.id,
          phase: ns > ew ? "ns" : "ew",
          seconds: 20,
        });
    }
}
