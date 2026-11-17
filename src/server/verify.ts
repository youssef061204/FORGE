/**
 * Lowering to forge-ir/v1 and translation validation. Filled in with the IR
 * lowering; until then builds report the differential check as not run.
 */
import type { Plan } from "../core/recipe/engine";
import type { Recipe } from "../core/recipe/schema";
import type { Inputs } from "../core/verify/variants";

export type VerifyCheck = { kind: "differential" | "replay"; name: string; passed: boolean; detail?: string };

export function lowerAndVerify(recipe: Recipe, plan: Plan, inputs: Inputs[] = []): { lowered?: { irHash: string; ir: unknown; typescript?: string }; checks: VerifyCheck[] } {
  void recipe;
  void plan;
  void inputs;
  return { checks: [] };
}
