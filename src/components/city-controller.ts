import type { City, CityPlayer, PlayerInput } from "@/forge/city-contracts";
import {
  createPlayer,
  integratePlayer,
  nearbyResource,
  playerCollides,
} from "../forge/city-player";
export class CityController implements CityPlayer {
  x = 660;
  y = 428;
  vx = 0;
  vy = 0;
  facing: CityPlayer["facing"] = "down";
  moving = false;
  sprint = false;
  sequence = 0;
  overview = false;
  zoom?: number;
  initialized = false;
  camera?: { x: number; y: number; zoom: number };
  keys = new Set<string>();
  collide(city: City, x: number, y: number) {
    return playerCollides(city, x, y);
  }
  input(): Pick<PlayerInput, "dx" | "dy" | "sprint"> {
    const dx =
      (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0) -
      (this.keys.has("a") || this.keys.has("arrowleft") ? 1 : 0);
    const dy =
      (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0) -
      (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0);
    return { dx, dy, sprint: this.keys.has("shift") };
  }
  reconcile(player: CityPlayer, force = false) {
    if (force || !this.initialized) {
      Object.assign(this, player);
      this.initialized = true;
    } else {
      this.sequence = Math.max(this.sequence, player.sequence);
      if (Math.hypot(this.x - player.x, this.y - player.y) > 65) {
        this.x = player.x;
        this.y = player.y;
        this.vx = player.vx;
        this.vy = player.vy;
      }
    }
  }
  update(city: City, dt: number) {
    if (!this.initialized) this.reconcile(city.player ?? createPlayer(), true);
    integratePlayer(city, this, this.input(), Math.min(dt, 0.05));
  }
  nearby(city: City) {
    return nearbyResource(city, this);
  }
}
export function typingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input,textarea,select") || target.isContentEditable)
  );
}
