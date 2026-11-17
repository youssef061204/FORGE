import serialized from "./policy-model.json";
import { calibrate } from "./world-model";
type Boost = { base: number; trees: number[][][] };
type Linear = {
  weights: number[];
  bias: number;
  mean: number[];
  scale: number[];
};
type Risk = {
  kind: "boosting" | "linear" | "ensemble";
  model: Boost | Linear | { heads: Boost[] };
  calibration: { x: number[]; y: number[] };
};
type PolicyModel = {
  version: string;
  datasetHash: string;
  features: number;
  models: Record<string, Risk>;
  ensemble?: { heads: Boost[]; calibration: { x: number[]; y: number[] } };
  loss: { model: Boost; interval: number };
  behavior: {
    mean: number[];
    scale: number[];
    center: number[];
    components: number[][];
    centroids: number[][];
  };
};
const model = serialized as unknown as PolicyModel;
export const policyModelReady = () => model.version === "policy-model-1";
function treeValue(m: Boost, x: number[]) {
  return (
    m.base +
    m.trees.reduce((sum, tree) => {
      let node = 0,
        steps = 0;
      while (!tree[node][5] && steps++ < 128)
        node =
          x[tree[node][0]] <= tree[node][1] ? tree[node][2] : tree[node][3];
      return sum + tree[node][4];
    }, 0)
  );
}
export function predictPolicy(x: number[]) {
  if (!policyModelReady() || x.length !== model.features) return undefined;
  const risk = Object.fromEntries(
    Object.entries(model.models).map(([target, m]) => {
      const b =
        m.kind === "ensemble"
          ? 0
          : m.kind === "boosting"
            ? treeValue(m.model as Boost, x)
            : (() => {
                const linear = m.model as Linear;
                return (
                  linear.bias +
                  x.reduce(
                    (s, v, i) =>
                      s +
                      ((v - linear.mean[i]) / linear.scale[i]) *
                        linear.weights[i],
                    0,
                  )
                );
              })();
      const probability =
        m.kind === "ensemble"
          ? (m.model as { heads: Boost[] }).heads.reduce(
              (sum, head) => sum + 1 / (1 + Math.exp(-treeValue(head, x))),
              0,
            ) / (m.model as { heads: Boost[] }).heads.length
          : 1 / (1 + Math.exp(-b));
      return [target, calibrate(m.calibration, probability)];
    }),
  );
  const members =
    model.ensemble?.heads.map(
      (head) => 1 / (1 + Math.exp(-treeValue(head, x))),
    ) ?? [];
  const mean = members.length
    ? members.reduce((s, v) => s + v, 0) / members.length
    : 0;
  const uncertainty = members.length
    ? Math.sqrt(
        members.reduce((s, v) => s + (v - mean) ** 2, 0) / members.length,
      )
    : 0;
  return {
    unsafe: risk.unsafe,
    brokerDenied: risk.brokerDenied,
    degraded: risk.degraded,
    loss: treeValue(model.loss.model, x),
    interval: model.loss.interval,
    version: model.version,
    uncertainty,
  };
}
export function embedBehavior(values: number[]) {
  if (!policyModelReady() || values.length !== model.behavior.mean.length)
    return undefined;
  const b = model.behavior;
  const normalized = values.map(
    (v, i) => (v - b.mean[i]) / b.scale[i] - b.center[i],
  );
  const embedding = b.components.map((c) =>
    c.reduce((s, v, i) => s + v * normalized[i], 0),
  );
  const distances = b.centroids.map((c) =>
    Math.hypot(...c.map((v, i) => v - embedding[i])),
  );
  return { embedding, cluster: distances.indexOf(Math.min(...distances)) };
}
export function behaviorDistance(a: number[], b: number[]) {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}
