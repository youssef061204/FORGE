import type { City, CityContest, GoalContract } from "./city-contracts";
import type { Release } from "./records";
import { digest } from "./hash";
/** Local single-owner memory; never an imported source corpus or permission grant. */
export function programMemory(
  city: City,
  goal: GoalContract,
  releases: Release[],
  contests: CityContest[],
) {
  return releases
    .filter(
      (r) =>
        r.status === "installed" &&
        r.definition.executable?.interface === "city/v1" &&
        r.definition.goal &&
        r.futures?.passed &&
        contests.some(
          (c) => c.id === r.futures!.contestId && c.environmentId === city.id,
        ),
    )
    .map((r) => ({
      id: r.definition.id,
      version: r.definition.version,
      digest: r.digest,
      sourceHash: digest(r.definition.executable!.source),
      goalHash: digest(r.definition.goal),
      environment: city.id,
      match: r.definition.goal!.objectives.filter((a) =>
        goal.objectives.some((b) => a.metric === b.metric),
      ).length,
      exact: digest(goal) === digest(r.definition.goal),
      source: r.definition.executable!.source,
    }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.match - a.match)
    .slice(0, 4);
}
export function metaDecision(input: {
  exact: boolean;
  parent: boolean;
  compose: boolean;
  controller?: string;
  lowConfidence: boolean;
  unsafeObserved: boolean;
}) {
  if (input.unsafeObserved)
    return {
      action: "CLARIFY",
      reason: "No measured safe candidate; authority unchanged",
    };
  if (input.exact)
    return {
      action: "REUSE",
      reason: "Exact installed goal, source and environment assumptions",
    };
  if (input.parent)
    return {
      action: "EXTEND",
      reason: "Retain installed behavior; fresh local testing and approval",
    };
  if (input.compose)
    return {
      action: "COMPOSE",
      reason: "Composed source still earns independent admission",
    };
  if (input.lowConfidence)
    return {
      action: "MORE_FUTURES",
      reason: "Outside training support; require full actual simulation",
    };
  return {
    action: input.controller?.toUpperCase() ?? "GENERATE",
    reason:
      "Explicit strategy produces reviewable code; predictions never grant authority",
  };
}
