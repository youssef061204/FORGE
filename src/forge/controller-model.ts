import {
  environmentResponseSchema,
  developmentGoal,
  type EnvironmentModel,
} from "./city-model";
import { controllerSource, type ControllerKind } from "./city-controllers";
import { placementSource } from "./resource-placement";
/** An explicit owner choice of a measured host controller; never advertised as an LLM. */
export class ControllerModel implements EnvironmentModel {
  constructor(
    private kind:
      Exclude<ControllerKind, "fixed" | "generated-fixture"> | "placement",
  ) {}
  async generate() {
    const contract = structuredClone(developmentGoal);
    if (this.kind === "placement") {
      contract.goal =
        "Pre-position responders and dispatch to active incidents";
      contract.interpretation =
        "Compare learned future demand with current-demand optimization and seeded random placement. Review sources and sampled incident response before approval.";
      contract.objectives = [
        { metric: "responseSeconds", direction: "minimize", weight: 1 },
      ];
      contract.actions = ["vehicle.route", "vehicle.dispatch"];
      return {
        value: environmentResponseSchema.parse({
          kind: "goal",
          contract,
          resolution: "SYNTHESIZE",
          candidates: [
            {
              name: "Learned responder placement",
              source: placementSource("learned"),
            },
            {
              name: "Current-demand optimization",
              source: placementSource("optimization"),
            },
            {
              name: "Seeded random comparison",
              source: placementSource("random"),
            },
          ],
        }),
        evidence: {
          provider: "HOST CONTROLLER",
          model: "placement-demand-1",
          region: "local",
          profile: "none",
          requestIds: [],
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          schemaValid: true,
        },
      };
    }
    contract.goal =
      "Reduce traffic congestion with " + this.kind + " signal control";
    contract.interpretation =
      "Compare an explicitly selected host controller against pressure control and the fixture development algorithm. All require local testing and owner approval.";
    contract.objectives = [
      { metric: "congestion", direction: "minimize", weight: 1 },
    ];
    contract.actions = ["signal.set"];
    return {
      value: environmentResponseSchema.parse({
        kind: "goal",
        contract,
        resolution: "SYNTHESIZE",
        candidates: [
          {
            name: this.kind + " controller",
            source: controllerSource(this.kind),
          },
          { name: "Pressure comparison", source: controllerSource("pressure") },
          {
            name: "Development comparison",
            source: controllerSource("generated-fixture"),
          },
        ],
      }),
      evidence: {
        provider: "HOST CONTROLLER",
        model: this.kind,
        region: "local",
        profile: "none",
        requestIds: [],
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        schemaValid: true,
      },
    };
  }
}
