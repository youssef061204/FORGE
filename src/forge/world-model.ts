import serialized from "./forecast-model.json";
import adapted from "./adapted-model.json";
import { digest } from "./hash";
import type { City } from "./city-contracts";
import {
  forecastFeatures,
  observeForecastNodes,
  forecastTargets,
  featureNames,
} from "./forecast-features";
type Boost = { base: number; trees: number[][][] };
type Neural = {
  kind: "neural";
  columns: number[];
  weights: number[][][];
  biases: number[][];
  mean: number[];
  scale: number[];
  targetMean: number[];
  targetScale: number[];
  output: number | null;
};
type Predictor =
  | Neural
  | { kind: "boost"; heads: Boost[] }
  | { kind: "persistence" }
  | { kind: "moving-average"; width: number }
  | {
      kind: "linear";
      weights: number[][];
      bias: number[];
      mean: number[];
      scale: number[];
      targetMean: number[];
      targetScale: number[];
    }
  | { kind: "independent"; heads: Neural[] };
type Calibration = { x: number[]; y: number[] };
type Bundle = {
  version: string;
  datasetHash: string;
  splitHash: string;
  selection: string[];
  models: Record<string, Predictor>;
  intervals: Record<string, number[]>;
  targets: string[];
  risk: Record<string, { model: Boost; calibration: Calibration }>;
  ood: {
    columns: number[];
    mean: number[];
    scale: number[];
    threshold: number;
  };
  anomaly: {
    columns: number[];
    mean: number[];
    scale: number[];
    trees: {
      feature: number[];
      threshold: number[];
      left: number[];
      right: number[];
      samples: number[];
    }[];
    sampleSize: number;
    calibration: Calibration;
    median: number[];
    mad: number[];
    robustCalibration: Calibration;
  };
};
const bundle = serialized as unknown as Bundle;
const baseModelHash = digest(bundle),
  adaptedModelHash = digest(adapted);
let activeVariant: "base" | "queue-adapted-2" = "base";
export function setForecastVariant(variant: "base" | "queue-adapted-2") {
  if (variant === "queue-adapted-2" && !adapted.validated)
    throw new Error("Candidate has not passed validation");
  if (activeVariant !== variant) {
    activeVariant = variant;
    cache.clear();
  }
}
export function candidateModelEvidence() {
  return {
    version: adapted.version,
    modelHash: adaptedModelHash,
    baseModelHash,
    datasetHash: adapted.datasetHash,
    validated: adapted.validated,
    active: activeVariant,
    scope:
      "Adapted queue head at +60 seconds only; other heads retain the base model",
  };
}
export function modelReady() {
  return bundle.version === "world-model-1" && bundle.selection?.length === 9;
}
function boost(model: Boost, x: number[]) {
  let value = model.base;
  for (const tree of model.trees) {
    let node = 0,
      steps = 0;
    while (!tree[node][5] && steps++ < 128)
      node = x[tree[node][0]] <= tree[node][1] ? tree[node][2] : tree[node][3];
    value += tree[node][4];
  }
  return value;
}
function neural(m: Neural, x: number[]) {
  let values = m.columns.map((i) => (x[i] - m.mean[i]) / m.scale[i]);
  for (let layer = 0; layer < m.weights.length; layer++) {
    const weights = m.weights[layer],
      bias = m.biases[layer];
    values = bias.map(
      (b, j) => b + values.reduce((s, v, i) => s + v * weights[i][j], 0),
    );
    if (layer < m.weights.length - 1)
      values = values.map((v) => Math.max(0, v));
  }
  return m.output === null
    ? values.map((v, j) => v * m.targetScale[j] + m.targetMean[j])
    : values.map((v) => v * m.targetScale[m.output!] + m.targetMean[m.output!]);
}
function infer(m: Predictor, x: number[]): number[] {
  if (m.kind === "persistence") return x.slice(0, 9);
  if (m.kind === "moving-average")
    return Array.from(
      { length: 9 },
      (_, j) => (x[j] + x[j + m.width] + x[j + 2 * m.width]) / 3,
    );
  if (m.kind === "boost") return m.heads.map((h) => boost(h, x));
  if (m.kind === "neural") return neural(m, x);
  if (m.kind === "independent") return m.heads.map((h) => neural(h, x)[0]);
  return m.bias.map(
    (b, j) =>
      (b +
        x.reduce(
          (s, v, i) => s + ((v - m.mean[i]) / m.scale[i]) * m.weights[i][j],
          0,
        )) *
        m.targetScale[j] +
      m.targetMean[j],
  );
}
export function calibrate(c: Calibration, value: number) {
  if (value <= c.x[0]) return c.y[0];
  for (let i = 1; i < c.x.length; i++)
    if (value <= c.x[i]) {
      const fraction =
        (value - c.x[i - 1]) / Math.max(Number.EPSILON, c.x[i] - c.x[i - 1]);
      return c.y[i - 1] + fraction * (c.y[i] - c.y[i - 1]);
    }
  return c.y.at(-1)!;
}
export function predictFeatures(
  x: number[],
  variant: "base" | "queue-adapted-2" = activeVariant,
) {
  if (!modelReady()) throw new Error("Forecast model has not been trained");
  const predictions = new Map<string, number[]>();
  for (const name of new Set(bundle.selection))
    predictions.set(name, infer(bundle.models[name], x));
  const values = bundle.selection.map((name, j) =>
    Math.max(
      0,
      Math.min(j >= 4 && j <= 7 ? 1 : Infinity, predictions.get(name)![j]),
    ),
  );
  if (variant === "queue-adapted-2" && adapted.validated && x.at(-1) === 0.5)
    values[0] = Math.max(0, boost(adapted.head, x));
  const risk = Object.fromEntries(
    Object.entries(bundle.risk).map(([name, r]) => [
      name,
      calibrate(r.calibration, 1 / (1 + Math.exp(-boost(r.model, x)))),
    ]),
  );
  const ood = Math.sqrt(
    bundle.ood.columns.reduce(
      (s, column, i) =>
        s + ((x[column] - bundle.ood.mean[i]) / bundle.ood.scale[i]) ** 2,
      0,
    ) / bundle.ood.columns.length,
  );
  return { values, risk, ood, lowConfidence: ood > bundle.ood.threshold };
}
const pathCorrection = (n: number) =>
  n <= 1
    ? 0
    : n === 2
      ? 1
      : 2 * (Math.log(n - 1) + 0.5772156649015329) - (2 * (n - 1)) / n;
export function telemetryRisk(x: number[]) {
  if (!modelReady()) return undefined;
  const m = bundle.anomaly;
  const values = m.columns.map(
    (column, i) => (x[column] - m.mean[i]) / m.scale[i],
  );
  const depths = m.trees.map((t) => {
    let node = 0,
      depth = 0;
    while (t.left[node] !== -1 && depth < 128) {
      node =
        values[t.feature[node]] <= t.threshold[node]
          ? t.left[node]
          : t.right[node];
      depth++;
    }
    return depth + pathCorrection(t.samples[node]);
  });
  const score =
    2 **
    (-depths.reduce((s, d) => s + d, 0) /
      depths.length /
      pathCorrection(m.sampleSize));
  return calibrate(m.calibration, score);
}
export type NodeForecast = {
  nodeId: string;
  values: Record<(typeof forecastTargets)[number], number>;
  interval95: Record<(typeof forecastTargets)[number], [number, number]>;
  outageProbability: number;
  blockedProbability: number;
  anomalyProbability: number;
  lowConfidence: boolean;
};
export type CityForecast = {
  label: "FORECAST";
  version: string;
  datasetHash: string;
  observedAt: number;
  horizon: 30 | 60 | 120;
  lowConfidence: boolean;
  fallback: "full-simulation" | "simulation-required-before-approval";
  nodes: NodeForecast[];
};
const history = new Map<string, { seconds: number; observed: number[][] }[]>();
const cache = new Map<string, CityForecast>();
/** Host-side observation history is never fed future data or external Google state. */
export function forecastCity(
  city: City,
  horizon: 30 | 60 | 120 = 60,
  variant: "base" | "queue-adapted-2" = activeVariant,
): CityForecast | undefined {
  if (!modelReady()) return undefined;
  const key =
    city.id +
    "|" +
    city.revision +
    "|" +
    city.seconds +
    "|" +
    horizon +
    "|" +
    variant;
  const cached = cache.get(key);
  if (cached) return cached;
  const observed = observeForecastNodes(city);
  const previous = history.get(city.id) ?? [];
  const entries =
    (previous.at(-1)?.seconds ?? -Infinity) > city.seconds
      ? []
      : previous.filter((e) => e.seconds >= city.seconds - 40);
  if (!entries.length || entries.at(-1)!.seconds < city.seconds)
    entries.push({ seconds: city.seconds, observed });
  else entries[entries.length - 1] = { seconds: city.seconds, observed };
  history.set(city.id, entries);
  const lag = (seconds: number) =>
    [...entries].reverse().find((e) => e.seconds <= city.seconds - seconds)
      ?.observed ?? observed;
  const widths = [...bundle.intervals[String(horizon)]];
  if (variant === "queue-adapted-2" && adapted.validated && horizon === 60)
    widths[0] = adapted.interval95;
  const nodes = city.nodes.map((node, i) => {
    const x = forecastFeatures(city, observed, lag(10), lag(20), i, horizon);
    const prediction = predictFeatures(x, variant);
    const values = Object.fromEntries(
      forecastTargets.map((name, j) => [name, prediction.values[j]]),
    ) as NodeForecast["values"];
    const interval95 = Object.fromEntries(
      forecastTargets.map((name, j) => [
        name,
        [
          Math.max(0, prediction.values[j] - widths[j]),
          prediction.values[j] + widths[j],
        ],
      ]),
    ) as NodeForecast["interval95"];
    return {
      nodeId: node.id,
      values,
      interval95,
      outageProbability: prediction.risk.outage,
      blockedProbability: prediction.risk.blocked,
      anomalyProbability: telemetryRisk(x) ?? 0,
      lowConfidence: prediction.lowConfidence,
    };
  });
  const lowConfidence =
    Boolean(city.map) ||
    nodes.some((n) => n.lowConfidence) ||
    entries.length < 3;
  const result: CityForecast = {
    label: "FORECAST",
    version:
      variant === "queue-adapted-2" && adapted.validated && horizon === 60
        ? adapted.version
        : bundle.version,
    datasetHash: bundle.datasetHash,
    observedAt: city.seconds,
    horizon,
    lowConfidence,
    fallback: lowConfidence
      ? "full-simulation"
      : "simulation-required-before-approval",
    nodes,
  };
  if (cache.size > 12) cache.clear();
  cache.set(key, result);
  return result;
}
export function worldModelEvidence() {
  return modelReady()
    ? {
        version: bundle.version,
        datasetHash: bundle.datasetHash,
        splitHash: bundle.splitHash,
        selection: bundle.selection,
        features: featureNames.length,
        targets: bundle.targets,
        validationOnlyCalibration: true,
      }
    : null;
}
