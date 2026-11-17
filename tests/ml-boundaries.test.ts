import { describe, it, expect } from "vitest";
import { createCity, advanceCity } from "../src/forge/city-engine";
import {
  forecastCity,
  setForecastVariant,
  predictFeatures,
  candidateModelEvidence,
} from "../src/forge/world-model";
import {
  forecastFeatures,
  observeForecastNodes,
} from "../src/forge/forecast-features";
import { monitorForecast } from "../src/forge/forecast-monitor";
import { ControllerModel } from "../src/forge/controller-model";
import { compileExecutable } from "../src/forge/executable";
describe("Learned components retain host boundaries", () => {
  it("promotes only the validated +60 second queue head and rolls back exact predictions", () => {
    const city = createCity(6821341),
      obs = observeForecastNodes(city),
      x = forecastFeatures(city, obs, obs, obs, 0, 60);
    setForecastVariant("base");
    const base = predictFeatures(x);
    expect(candidateModelEvidence().validated).toBe(true);
    setForecastVariant("queue-adapted-2");
    const candidate = predictFeatures(x);
    expect(candidate.values[0]).not.toEqual(base.values[0]);
    expect(x).toHaveLength(121);
    expect(candidate.values.slice(1)).toEqual(base.values.slice(1));
    expect(candidate.risk).toEqual(base.risk);
    setForecastVariant("base");
    expect(predictFeatures(x)).toEqual(base);
  });
  it("never evaluates a forecast against a future that has not happened", () => {
    const city = createCity(812383);
    city.id = "monitor-test";
    expect(monitorForecast(city).completedForecasts).toBe(0);
    advanceCity(city, 30, false);
    expect(monitorForecast(city).completedForecasts).toBe(0);
    advanceCity(city, 30, false);
    const evaluated = monitorForecast(city);
    expect(evaluated.completedForecasts).toBeGreaterThan(0);
    expect(evaluated.shadow.completedPairs).toBeGreaterThan(0);
    expect(evaluated.shadow.candidateQueueMAE).not.toBeNull();
    city.seconds = 0;
    expect(monitorForecast(city).completedForecasts).toBe(0);
  });
  it("invalidates temporal history when a scene goes backwards", () => {
    const city = createCity(93111);
    city.id = "history-reset-test";
    forecastCity(city);
    advanceCity(city, 40, false);
    forecastCity(city);
    city.seconds = 0;
    city.revision++;
    expect(forecastCity(city)?.lowConfidence).toBe(true);
  });
  it("preserves temporal observations across model promotion and exact rollback", () => {
    const city = createCity(718293);
    city.id = "promotion-history-test";
    setForecastVariant("base");
    forecastCity(city);
    advanceCity(city, 10, false);
    forecastCity(city);
    advanceCity(city, 10, false);
    const base = forecastCity(city);
    expect(base?.lowConfidence).toBe(false);
    setForecastVariant("queue-adapted-2");
    const candidate = forecastCity(city);
    expect(candidate?.nodes.map((n) => n.values.queue)).not.toEqual(
      base?.nodes.map((n) => n.values.queue),
    );
    setForecastVariant("base");
    expect(forecastCity(city)).toEqual(base);
  });
  it("uses the same pruned observations for both heads after a long observation gap", () => {
    const city = createCity(817211);
    city.id = "pruned-history-test";
    forecastCity(city, 60, "base");
    advanceCity(city, 80, false);
    const base = forecastCity(city, 60, "base");
    const candidate = forecastCity(city, 60, "queue-adapted-2");
    expect(candidate?.nodes.map((n) => n.values.delay)).toEqual(
      base?.nodes.map((n) => n.values.delay),
    );
    expect(candidate?.lowConfidence).toEqual(base?.lowConfidence);
  });
  it("learned controllers emit ordinary strict typed programs and no model authority", async () => {
    const generation = await new ControllerModel("hybrid").generate();
    expect(generation.evidence.provider).toBe("HOST CONTROLLER");
    expect(generation.value.kind).toBe("goal");
    if (generation.value.kind === "goal") {
      expect(generation.value.contract.actions).toEqual(["signal.set"]);
      generation.value.candidates.forEach((c) =>
        expect(() => compileExecutable(c.source, "city/v1")).not.toThrow(),
      );
    }
  });
  it("learned placement has only route and responder dispatch authority", async () => {
    const generation = await new ControllerModel("placement").generate();
    expect(generation.evidence.provider).toBe("HOST CONTROLLER");
    if (generation.value.kind !== "goal") throw new Error("Expected goal");
    expect(generation.value.contract.actions).toEqual([
      "vehicle.route",
      "vehicle.dispatch",
    ]);
    generation.value.candidates.forEach((c) =>
      expect(() => compileExecutable(c.source, "city/v1")).not.toThrow(),
    );
  });
});
