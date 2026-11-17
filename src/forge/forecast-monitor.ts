import type { City } from "./city-contracts";
import { forecastCity } from "./world-model";
import { observeForecastNodes } from "./forecast-features";
type Probe = {
  at: number;
  predicted: number[];
  base: number[];
  candidate: number[];
};
const entries = new Map<
  string,
  {
    last: number;
    probes: Probe[];
    residuals: number[];
    shadow: { base: number; candidate: number; at: number }[];
  }
>();
/** Closed-loop residuals from forecasts made before the observed outcome exists. */
export function monitorForecast(city: City) {
  let entry = entries.get(city.id);
  if (!entry || city.seconds < entry.last) {
    entry = { last: city.seconds, probes: [], residuals: [], shadow: [] };
    entries.set(city.id, entry);
  }
  const now = observeForecastNodes(city);
  for (const probe of entry.probes.filter((p) => p.at + 60 <= city.seconds)) {
    const residual = (values: number[]) =>
      values.reduce((s, p, i) => s + Math.abs(p - now[i][0]), 0) /
      values.length;
    entry.residuals.push(residual(probe.predicted));
    entry.shadow.push({
      base: residual(probe.base),
      candidate: residual(probe.candidate),
      at: city.seconds,
    });
  }
  entry.probes = entry.probes.filter((p) => p.at + 60 > city.seconds);
  if (city.seconds >= entry.last + 10 || !entry.probes.length) {
    const prediction = forecastCity(city, 60);
    if (prediction) {
      const base = forecastCity(city, 60, "base")!;
      const candidate = forecastCity(city, 60, "queue-adapted-2")!;
      entry.probes.push({
        at: city.seconds,
        predicted: prediction.nodes.map((n) => n.values.queue),
        base: base.nodes.map((n) => n.values.queue),
        candidate: candidate.nodes.map((n) => n.values.queue),
      });
      entry.last = city.seconds;
    }
  }
  entry.residuals = entry.residuals.slice(-20);
  entry.shadow = entry.shadow.slice(-20);
  if (entries.size > 8) entries.delete(entries.keys().next().value!);
  const mae = entry.residuals.length
    ? entry.residuals.reduce((s, v) => s + v, 0) / entry.residuals.length
    : null;
  return {
    completedForecasts: entry.residuals.length,
    actualQueueMAE: mae,
    shadow: {
      completedPairs: entry.shadow.length,
      baseQueueMAE: entry.shadow.length
        ? entry.shadow.reduce((s, p) => s + p.base, 0) / entry.shadow.length
        : null,
      candidateQueueMAE: entry.shadow.length
        ? entry.shadow.reduce((s, p) => s + p.candidate, 0) /
          entry.shadow.length
        : null,
      scope:
        "Same past observations; the first observation at or after +60 seconds evaluates both shadows. Neither changes live predictions or authority",
    },
    drift: mae !== null && mae > 1.5,
    threshold: 1.5,
    thresholdScope:
      "Operational review trigger configured before current outcomes, not a model accuracy guarantee",
    action:
      "Review model and program assumptions; no automatic training, promotion or authority change",
  };
}
