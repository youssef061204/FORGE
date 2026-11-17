import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const dir = "artifacts/ml/external";
await mkdir(dir, { recursive: true });
const url =
  "https://raw.githubusercontent.com/numenta/NAB/master/data/realKnownCause/nyc_taxi.csv";
let csv: string;
try {
  csv = await readFile(dir + "/nyc_taxi.csv", "utf8");
} catch {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error("External dataset HTTP " + r.status);
  csv = await r.text();
  await writeFile(dir + "/nyc_taxi.csv", csv);
}
const rows = csv
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => {
    const [at, n] = l.split(",");
    return { at, value: Number(n) };
  });
const split = Math.floor(rows.length * 0.6),
  validation = Math.floor(rows.length * 0.8),
  train = rows.slice(0, split);
const mean = train.reduce((s, r) => s + r.value, 0) / train.length,
  sd = Math.sqrt(
    train.reduce((s, r) => s + (r.value - mean) ** 2, 0) / train.length,
  );
const predictions: {
  index: number;
  split: string;
  at: string;
  y: number;
  persistence: number;
  seasonal: number;
  average: number;
  z: number;
}[] = [];
for (let i = 48; i < rows.length; i++) {
  const y = rows[i].value,
    persistence = rows[i - 1].value,
    seasonal = rows[i - 48].value,
    average = rows.slice(i - 48, i).reduce((s, r) => s + r.value, 0) / 48;
  predictions.push({
    index: i,
    split: i < split ? "train" : i < validation ? "validation" : "heldout",
    at: rows[i].at,
    y,
    persistence,
    seasonal,
    average,
    z: Math.abs(y - mean) / sd,
  });
}
const measured = Object.fromEntries(
  ["validation", "heldout"].map((part) => {
    const p = predictions.filter((r) => r.split === part);
    return [
      part,
      Object.fromEntries(
        ["persistence", "seasonal", "average"].map((key) => [
          key,
          {
            mae:
              p.reduce(
                (s, r) =>
                  s +
                  Math.abs(
                    r.y - r[key as "persistence" | "seasonal" | "average"],
                  ),
                0,
              ) / p.length,
            rmse: Math.sqrt(
              p.reduce(
                (s, r) =>
                  s +
                  (r.y - r[key as "persistence" | "seasonal" | "average"]) ** 2,
                0,
              ) / p.length,
            ),
            samples: p.length,
          },
        ]),
      ),
    ];
  }),
);
await writeFile(
  "artifacts/ml/external-eval.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      source: url,
      dataset:
        "Numenta Anomaly Benchmark NYC taxi demand, actual recorded counts",
      license: "NAB repository AGPL-3.0; cached research input only",
      datasetHash: createHash("sha256").update(csv).digest("hex"),
      totalSamples: rows.length,
      split: {
        train: split,
        validation: validation - split,
        heldout: rows.length - validation,
      },
      results: measured,
      scope:
        "Chronological external demand forecasting baselines only. Northbank neural forecasts have incompatible units and inputs and are NOT claimed to transfer.",
      physicalDisasterValidation: false,
      predictions: predictions.filter((r) => r.split === "heldout"),
    },
    null,
    2,
  ),
);
console.log("External evaluation " + rows.length + " actual measurements");
