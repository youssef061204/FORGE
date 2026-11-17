import { describe, it, expect } from "vitest";
import {
  createCity,
  advanceCity,
  controlCity,
  applyCityAction,
} from "../src/forge/city-engine";
import {
  createPlayer,
  integratePlayer,
  nearbyResource,
} from "../src/forge/city-player";
import { citySchema, playerInputSchema } from "../src/forge/city-contracts";
describe("physical City boundaries", () => {
  it("uses direction inputs, not arbitrary coordinates, and limits displacement", () => {
    expect(
      playerInputSchema.safeParse({
        dx: 0,
        dy: 0,
        sprint: false,
        sequence: 1,
        elapsedMs: 100,
        x: 9999,
      }).success,
    ).toBe(false);
    const city = createCity(12),
      player = createPlayer();
    integratePlayer(city, player, { dx: 1, dy: 1, sprint: true }, 999);
    expect(Math.hypot(player.x - 660, player.y - 428)).toBeLessThanOrEqual(48);
  });
  it("cannot pass through buildings or the river and stops with released input", () => {
    const city = createCity(12),
      player = createPlayer();
    player.x = 180;
    player.y = 220;
    for (let i = 0; i < 30; i++)
      integratePlayer(city, player, { dx: 1, dy: 0, sprint: true }, 0.1);
    expect(player.x).toBeLessThan(184);
    player.x = 1085;
    player.y = 700;
    player.vx = 0;
    for (let i = 0; i < 30; i++)
      integratePlayer(city, player, { dx: 1, dy: 0, sprint: true }, 0.1);
    expect(player.x).toBeLessThan(1094);
    for (let i = 0; i < 20; i++)
      integratePlayer(city, player, { dx: 0, dy: 0, sprint: false }, 0.1);
    expect(player.moving).toBe(false);
  });
  it("interacts only inside a bounded resource radius", () => {
    const city = createCity(12);
    expect(nearbyResource(city, { x: 28, y: 28 }, 20)).toBeUndefined();
    expect(
      nearbyResource(city, {
        x: city.buildings[0].x - 12,
        y: city.buildings[0].y + 40,
      }),
    ).toBe(city.buildings[0].id);
    expect(nearbyResource(city, { x: 140, y: 130 })).toBe("n-0-0");
  });
  it("spreads terrain water and ignition, affecting actual routes", () => {
    const city = createCity(12);
    controlCity(city, {
      operation: "hazard.create",
      kind: "flood",
      x: 980,
      y: 650,
      intensity: 0.9,
      radius: 180,
    });
    for (let i = 0; i < 50; i++) advanceCity(city, 2, false);
    expect(
      city.terrain!.cells.filter((c) => c.water > 0.15).length,
    ).toBeGreaterThan(5);
    expect(city.roads.some((r) => r.floodDepth > 0.2 && r.risk > 0)).toBe(true);
    controlCity(city, {
      operation: "hazard.create",
      kind: "wildfire",
      x: 420,
      y: 650,
      intensity: 0.9,
      radius: 180,
    });
    for (let i = 0; i < 25; i++) advanceCity(city, 2, false);
    expect(city.terrain!.cells.some((c) => c.fire > 0.2 && c.fuel < 0.5)).toBe(
      true,
    );
    expect(city.terrain!.cells.some((c) => c.smoke > 0.03)).toBe(true);
    expect(citySchema.safeParse(city).success).toBe(true);
  });
  it("propagates a plant failure, turns off signals and supplies the hospital generator", () => {
    const city = createCity(12),
      plant = city.buildings.find((b) => b.kind === "plant")!;
    controlCity(city, {
      operation: "building.damage",
      buildingId: plant.id,
      damage: 0.9,
    });
    advanceCity(city, 2, false);
    const hospital = city.buildings.find((b) => b.kind === "hospital")!;
    expect(city.gridNodes!.find((g) => g.buildingId === plant.id)!.failed).toBe(
      true,
    );
    expect(city.nodes.some((n) => n.powered === false)).toBe(true);
    expect(hospital.generatorActive).toBe(true);
    expect(hospital.power).toBe(1);
    expect(() =>
      applyCityAction(city, {
        operation: "grid.shed",
        buildingId: hospital.id,
        power: 0.1,
      }),
    ).toThrow("power floor");
  });
});
