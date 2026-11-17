import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createCity,
  advanceCity,
  controlCity,
  applyCityAction,
  random,
} from "../../src/forge/city-engine";
import type { City } from "../../src/forge/city-contracts";
const output = "artifacts/ml";
await mkdir(output, { recursive: true });
export function signalObservation(city: City) {
  return city.nodes.map((n) => {
    const ns = city.vehicles.filter(
      (v) =>
        v.path[0] === n.id &&
        v.wait > 0 &&
        city.nodes.find((p) => p.id === v.path[1])?.y !== n.y,
    );
    const ew = city.vehicles.filter(
      (v) => v.path[0] === n.id && v.wait > 0 && !ns.includes(v),
    );
    return [
      ns.length / 10,
      ew.length / 10,
      ns.reduce((s, v) => s + v.wait, 0) / 120,
      ew.reduce((s, v) => s + v.wait, 0) / 120,
      n.signal === "ns" ? 1 : 0,
      n.signalRemaining / 20,
    ];
  });
}
if (!process.argv.includes("--evaluate")) {
  const rows: unknown[] = [];
  const episodes: unknown[] = [];
  let index = 0;
  for (const [split, count] of Object.entries({
    train: 80,
    validation: 16,
    heldout: 24,
    shift: 16,
  }))
    for (let e = 0; e < count; e++) {
      const seed = 22000000 + index * 6121,
        city = createCity(seed);
      if (e % 2 === 0 || split === "shift")
        for (let k = 0; k < (split === "shift" ? 3 : 2); k++)
          controlCity(city, { operation: "traffic.add", count: 25 });
      if (e % 3 === 0)
        controlCity(city, {
          operation: "hazard.create",
          kind: "traffic",
          x: city.nodes[(e * 7) % 48].x,
          y: city.nodes[(e * 7) % 48].y,
          radius: 180,
          intensity: split === "shift" ? 0.95 : 0.65,
        });
      let totalReward = 0;
      for (let step = 0; step < 24; step++) {
        const before = signalObservation(city);
        const actions = city.nodes.map((n, i) =>
          n.signalRemaining <= 5
            ? random(city) > 0.5
              ? 0
              : 1
            : before[i][4]
              ? 0
              : 1,
        );
        for (let i = 0; i < 48; i++)
          if (city.nodes[i].signalRemaining <= 5) {
            const phase = actions[i] === 0 ? "ns" : "ew";
            if (phase !== city.nodes[i].signal)
              applyCityAction(city, {
                operation: "signal.set",
                nodeId: city.nodes[i].id,
                phase,
                seconds: 18,
              });
          }
        advanceCity(city, 10, false);
        const after = signalObservation(city);
        for (let i = 0; i < 48; i++) {
          const reward =
            -(after[i][2] + after[i][3]) - (after[i][0] + after[i][1]) * 0.5;
          rows.push({
            episode: "control-" + index,
            split,
            seed,
            step,
            node: city.nodes[i].id,
            state: before[i],
            action: actions[i],
            reward,
            next: after[i],
            done: step === 23,
          });
          totalReward += reward;
        }
      }
      episodes.push({ id: "control-" + index, split, seed, totalReward });
      index++;
    }
  const encoded = JSON.stringify(rows);
  await writeFile(
    output + "/control-dataset.json",
    JSON.stringify({
      createdAt: new Date().toISOString(),
      episodes,
      rows,
      datasetHash: createHash("sha256").update(encoded).digest("hex"),
      source:
        "Actual City engine; exploration actions applied through host signal safety gate; deployment evaluation separately uses worker/broker",
    }),
  );
  console.log("RL transitions collected: " + rows.length);
} else {
  // The complete paired evaluator is filled from the frozen trained controller
  // and compiler evidence; reject missing artifacts instead of reporting success.
  await readFile("src/forge/rl-model.json", "utf8");
  const { benchmarkControllers } = await import("./evaluate-controllers");
  await benchmarkControllers();
}
