import type { City, CityPlayer, PlayerInput } from "./city-contracts";

export function createPlayer(): CityPlayer {
  return {
    x: 660,
    y: 428,
    vx: 0,
    vy: 0,
    facing: "down",
    moving: false,
    sprint: false,
    sequence: 0,
  };
}
export function playerCollides(city: City, x: number, y: number) {
  if (x < 24 || y < 24 || x > city.width - 24 || y > city.height - 24)
    return true;
  if (
    city.buildings.some(
      (b) =>
        x > b.x - 8 && x < b.x + b.w + 8 && y > b.y - 8 && y < b.y + b.h + 8,
    )
  )
    return true;
  return (
    !city.map &&
    x > 1094 &&
    x < 1148 &&
    ![390, 910, 1430].some((y0) => Math.abs(y - y0) < 26)
  );
}
/** Shared collision/acceleration; only the host commits authoritative position. */
export function integratePlayer(
  city: City,
  player: CityPlayer,
  input: Pick<PlayerInput, "dx" | "dy" | "sprint">,
  seconds: number,
) {
  const dt = Math.min(0.2, Math.max(0, seconds));
  const length = Math.hypot(input.dx, input.dy);
  const speed = input.sprint ? 240 : 140;
  const targetX = length ? (input.dx / Math.max(1, length)) * speed : 0;
  const targetY = length ? (input.dy / Math.max(1, length)) * speed : 0;
  const steps = Math.max(1, Math.ceil(dt / 0.016));
  const step = dt / steps;
  for (let i = 0; i < steps; i++) {
    const blend = 1 - Math.exp(-14 * step);
    player.vx += (targetX - player.vx) * blend;
    player.vy += (targetY - player.vy) * blend;
    const x = player.x + player.vx * step,
      y = player.y + player.vy * step;
    if (!playerCollides(city, x, player.y)) player.x = x;
    else player.vx = 0;
    if (!playerCollides(city, player.x, y)) player.y = y;
    else player.vy = 0;
  }
  player.moving = Math.hypot(player.vx, player.vy) > 3;
  player.sprint = input.sprint && player.moving;
  if (length)
    player.facing =
      Math.abs(input.dx) > Math.abs(input.dy)
        ? input.dx > 0
          ? "right"
          : "left"
        : input.dy > 0
          ? "down"
          : "up";
}
export function nearbyResource(
  city: City,
  player: Pick<CityPlayer, "x" | "y">,
  radius = 52,
) {
  const choices = city.buildings.map((b) => ({
    id: b.id,
    distance: Math.hypot(
      player.x - Math.max(b.x, Math.min(b.x + b.w, player.x)),
      player.y - Math.max(b.y, Math.min(b.y + b.h, player.y)),
    ),
  }));
  for (const n of city.nodes)
    choices.push({
      id: n.id,
      distance: Math.hypot(player.x - n.x, player.y - n.y),
    });
  const nodes = new Map(city.nodes.map((n) => [n.id, n]));
  for (const r of city.roads) {
    if (r.bridge && r.manualClosed && r.damage === 0) continue;
    const a = nodes.get(r.from)!,
      b = nodes.get(r.to)!;
    const u = Math.max(
      0,
      Math.min(
        1,
        ((player.x - a.x) * (b.x - a.x) + (player.y - a.y) * (b.y - a.y)) /
          r.length ** 2,
      ),
    );
    choices.push({
      id: r.id,
      distance:
        Math.hypot(
          player.x - a.x - u * (b.x - a.x),
          player.y - a.y - u * (b.y - a.y),
        ) + 15,
    });
  }
  return choices
    .filter((c) => c.distance <= radius)
    .sort((a, b) => a.distance - b.distance)[0]?.id;
}
