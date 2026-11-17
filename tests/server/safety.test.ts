import { describe, expect, it } from "vitest";
import { ATTACKS, runAttack } from "../../src/server/safety/attacks";

process.env.FORGE_MODEL_TRANSPORT = "scripted";

describe("Safety Lab: every attack is stopped", () => {
  it("has the eleven attacks from the brief", () => {
    expect(ATTACKS).toHaveLength(11);
  });
  it.each(ATTACKS.map((a) => [a.id] as const))("%s is blocked", async (id) => {
    const r = await runAttack(id);
    expect(r.blocked, r.log.join("\n")).toBe(true);
  });
});
