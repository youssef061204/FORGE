import type {
  City,
  CityAction,
  CityMetrics,
  GoalContract,
} from "./city-contracts";
import { cityActionNames, metricNames } from "./city-contracts";
import { observeForecastNodes } from "./forecast-features";
export function policyFeatures(
  city: City,
  goal: GoalContract,
  actions: CityAction[],
  early?: CityMetrics,
  earlyDenied = false,
) {
  const observations = observeForecastNodes(city);
  const means = Array.from(
    { length: 15 },
    (_, i) => observations.reduce((s, x) => s + x[i], 0) / observations.length,
  );
  const counts = cityActionNames.map(
    (op) => actions.filter((a) => a.operation === op).length / 48,
  );
  const criticalPower = actions.filter(
    (a) =>
      (a.operation === "grid.allocate" || a.operation === "grid.shed") &&
      city.buildings.some((b) => b.id === a.buildingId && b.critical),
  );
  const minCritical = criticalPower.reduce(
    (m, a) =>
      Math.min(m, (a as Extract<CityAction, { operation: "grid.shed" }>).power),
    1,
  );
  const initial = metricNames.map((m) => city.metrics[m]);
  const deltas = metricNames.map(
    (m) => (early?.[m] ?? city.metrics[m]) - city.metrics[m],
  );
  const constraints = metricNames.map(
    (m) => goal.hard.find((c) => c.metric === m)?.value ?? -1,
  );
  const objectives = metricNames.map((m) => {
    const o = goal.objectives.find((c) => c.metric === m);
    return o ? o.weight * (o.direction === "minimize" ? 1 : -1) : 0;
  });
  return [
    ...means,
    city.weather.rain,
    city.weather.wind,
    city.hazards.length,
    city.vehicles.length,
    ...initial,
    ...constraints,
    ...objectives,
    ...counts,
    minCritical,
    ...deltas,
    Number(earlyDenied),
  ];
}
export function behaviorRepresentation(
  actions: CityAction[],
  initial: CityMetrics,
  early: CityMetrics,
) {
  return [
    ...cityActionNames.map(
      (op) => actions.filter((a) => a.operation === op).length / 48,
    ),
    ...metricNames.map(
      (m) =>
        (early[m] - initial[m]) /
        (m.includes("Seconds")
          ? 120
          : m === "energyDemand"
            ? 140
            : m === "hospitalPower" || m === "congestion" || m === "gridLoad"
              ? 1
              : 64),
    ),
  ];
}
