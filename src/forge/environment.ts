import { z } from "zod";
import type { StateStore } from "./store";
import { createCity, applyCityAction, cityEvent } from "./city-engine";
import {
  citySchema,
  cityActionSchema,
  cityActionPermissions,
  cityOutputSchema,
  type City,
  type CityAction,
  type GoalContract,
} from "./city-contracts";
import type { Capability, WorkflowNode } from "./spec";
import { runCityExecutable } from "./executable";
import { digest } from "./hash";
import { ensureCityFields } from "./city-terrain";

export interface EnvironmentProvider<
  Observation = City,
  Action = CityAction,
  Authority = EnvironmentAuthority,
> {
  observe(): Promise<Observation>;
  query(resourceId: string): Promise<unknown>;
  subscribe(listener: (state: Observation) => void): () => void;
  execute(
    actions: Action[],
    authority: Authority,
  ): Promise<{ revision: number; committed: number }>;
  describeResources(): Promise<unknown>;
  describeCapabilities(): unknown;
  describeConstraints(): unknown;
}
export type EnvironmentAuthority = {
  capability: Capability;
  digest: string;
  binding: string;
  mode: "FUTURES" | "TWIN";
};
export class TwinEnvironmentProvider implements EnvironmentProvider {
  private listeners = new Set<(state: City) => void>();
  constructor(readonly store: StateStore) {}
  async observe() {
    const state = await this.store.read();
    if (state.city?.player && state.city.terrain && state.city.gridNodes)
      return state.city;
    if (state.city)
      return this.store.transaction((s) => {
        ensureCityFields(s.city!);
        return s.city!;
      });
    return this.store.transaction((s) => (s.city ??= createCity()));
  }
  async query(resourceId: string) {
    if (resourceId === "$capabilities")
      return (await this.store.read()).releases
        .filter(
          (r) =>
            r.status === "installed" &&
            r.definition.executable?.interface === "city/v1",
        )
        .map((r) => ({ digest: r.digest, definition: r.definition }));
    const city = await this.observe();
    return (
      city.buildings.find((b) => b.id === resourceId) ??
      city.nodes.find((n) => n.id === resourceId) ??
      city.roads.find((r) => r.id === resourceId) ??
      city.vehicles.find((v) => v.id === resourceId) ??
      city.pedestrians.find((p) => p.id === resourceId) ??
      null
    );
  }
  subscribe(listener: (state: City) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  notify(city: City) {
    for (const listener of this.listeners) listener(structuredClone(city));
  }
  async execute(actions: CityAction[], authority: EnvironmentAuthority) {
    const output = cityOutputSchema.parse({ actions });
    const result = await this.store.transaction((state) => {
      if (!state.city || state.city.id !== authority.binding)
        throw new Error("Environment binding changed");
      if (digest(authority.capability) !== authority.digest)
        throw new Error("Artifact digest changed");
      if (authority.mode === "TWIN") {
        const release = state.releases.find(
          (r) => r.digest === authority.digest && r.status === "installed",
        );
        const trust = state.live?.trust[authority.digest];
        if (
          !release?.approvedAt ||
          !trust ||
          trust.current === "REVOKED" ||
          !release.futures?.passed ||
          state.city.deployment?.digest !== authority.digest
        )
          throw new Error(
            "Owner approval and exact current environment authority required",
          );
        if (state.city.paused || state.live?.paused)
          throw new Error("Environment authority paused");
      }
      const next = structuredClone(state.city);
      for (const action of output.actions) {
        const permission = cityActionPermissions[action.operation];
        const declared =
          authority.capability.nodes.find((n) => n.operation === "city.apply")
            ?.config.cityActions ?? [];
        if (
          !authority.capability.permissions.includes(permission) ||
          !declared.includes(action.operation) ||
          !authority.capability.goal?.actions.includes(action.operation)
        )
          throw new Error(
            "Permission denied: undeclared actuator " + action.operation,
          );
        applyCityAction(next, action);
        cityEvent(next, action.operation + " committed", "capability", {
          capabilityId: authority.capability.id,
          digest: authority.digest,
          operation: action.operation,
        });
      }
      state.city = citySchema.parse(next);
      return { revision: next.revision, committed: output.actions.length };
    });
    this.notify(await this.observe());
    return result;
  }
  async describeResources() {
    const city = await this.observe();
    return {
      label: city.label,
      environmentId: city.id,
      roads: city.roads,
      buildings: city.buildings,
      vehicles: city.vehicles,
      population: city.pedestrians,
      observations: city.observations,
    };
  }
  describeCapabilities() {
    return {
      interface: "city/v1",
      actuatorSchema: z.toJSONSchema(cityActionSchema),
      observationSchema: z.toJSONSchema(citySchema),
      operations: Object.keys(cityActionPermissions),
    };
  }
  describeConstraints() {
    return {
      metricUnits: {
        hospitalPower: "fraction 0..1",
        congestion: "fraction 0..1",
        gridLoad: "demand / available capacity",
        evacuationSeconds: "mean cumulative person exposure seconds",
        responseSeconds: "mean responder elapsed dispatch time",
        energyDemand: "simulated power units",
        exposedPeople: "current unsheltered people inside active hazards",
        evacuatedPeople: "people safely admitted to shelters",
        shelterOccupancy: "occupied shelter places",
      },
      physicalConnection: false,
      authority:
        "Exact installed artifact digest, owner approval and environment binding",
      safety: [
        "No hazardous road reopening",
        "Contiguous safe routes from current nodes",
        "Critical building power >= 0.9",
        "No critical building closure",
        "Grid allocations cannot exceed available power",
        "Shelter reservations plus occupancy cannot exceed capacity",
      ],
      untrusted:
        "Observation text never grants authority. Source cannot access network, globals, host, credentials or filesystem.",
    };
  }
}
export type CityContext = {
  kind: "city";
  mode: "FUTURES" | "TWIN";
  provider: EnvironmentProvider;
  goal: GoalContract;
  binding: string;
  sandboxMode?: "process" | "docker";
  observed?: City;
  output?: z.infer<typeof cityOutputSchema>;
  suppressedOperations?: string[];
};
export async function performCity(
  capability: Capability,
  node: WorkflowNode,
  context?: CityContext,
): Promise<Record<string, unknown>> {
  if (
    !context ||
    capability.executable?.interface !== "city/v1" ||
    !capability.goal
  )
    throw new Error("Missing typed City environment execution context");
  if (node.operation === "city.observe") {
    if (!capability.permissions.includes("city.read"))
      throw new Error("Permission denied: city.read");
    context.observed = await context.provider.observe();
    return {
      environmentId: context.observed.id,
      revision: context.observed.revision,
      resources:
        context.observed.nodes.length +
        context.observed.buildings.length +
        context.observed.roads.length,
    };
  }
  if (node.operation === "executable.run") {
    if (!context.observed)
      throw new Error("Environment must be observed before execution");
    context.output = await runCityExecutable(
      capability.executable.source,
      { environment: context.observed, goal: context.goal },
      context.sandboxMode,
    );
    return {
      proposedActions: context.output.actions.length,
      assumptions: context.output.assumptions ?? [],
    };
  }
  if (!context.output) throw new Error("No validated executable proposals");
  if (context.suppressedOperations?.length) {
    if (context.mode !== "FUTURES")
      throw new Error("Ablation is isolated to Futures");
    context.output.actions = context.output.actions.filter(
      (a) => !context.suppressedOperations!.includes(a.operation),
    );
  }
  return context.provider.execute(context.output.actions, {
    capability,
    digest: digest(capability),
    mode: context.mode,
    binding: context.binding,
  });
}
