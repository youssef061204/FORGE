import { writeFile } from "node:fs/promises";
import {
  createCity,
  advanceCity,
  controlCity,
} from "../../src/forge/city-engine";
import {
  forecastFeatures,
  observeForecastNodes,
} from "../../src/forge/forecast-features";
const episodes = [];
for (let i = 0; i < 56; i++) {
  const split = i < 32 ? "train" : i < 40 ? "validation" : "heldout",
    city = createCity(58000000 + i * 931);
  controlCity(city, { operation: "traffic.add", count: 25 });
  controlCity(city, { operation: "traffic.add", count: 25 });
  city.weather.wind = 0.8;
  city.weather.rain = i % 2 ? 0.7 : 0;
  controlCity(city, {
    operation: "hazard.create",
    kind: i % 2 ? "flood" : "wildfire",
    x: city.nodes[(i * 7) % 48].x,
    y: city.nodes[(i * 7) % 48].y,
    radius: 300,
    intensity: 0.8,
  });
  const history: { city: typeof city; obs: number[][] }[] = [];
  for (let t = 0; t <= 210; t += 2) {
    history.push({
      city: structuredClone(city),
      obs: observeForecastNodes(city),
    });
    advanceCity(city, 2, false);
  }
  const rows = [];
  for (const origin of [30, 90, 150]) {
    const at = history[origin / 2],
      future = history[(origin + 60) / 2];
    for (let n = 0; n < 48; n++)
      rows.push({
        x: forecastFeatures(
          at.city,
          at.obs,
          history[origin / 2 - 5].obs,
          history[origin / 2 - 10].obs,
          n,
          60,
        ),
        y: future.obs[n][0],
      });
  }
  episodes.push({ id: "adapt-" + i, seed: 58000000 + i * 931, split, rows });
}
await writeFile(
  "artifacts/ml/adaptation-dataset.json",
  JSON.stringify({
    scope:
      "Fresh traffic/hazard shift episodes, separate from original train/validation/heldout/shift; queue +60s only",
    episodes,
  }),
);
console.log("Adaptation dataset: 56 whole episodes");
