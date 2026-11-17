import { deriveToolContract } from "./contracts";
import {
  derivePermissions,
  validateCapability,
  type Capability,
  type WorkflowNode,
  type Operation,
} from "./spec";
import { assertWorldRequestSupported, isWorldRequest, rooms } from "./world";

// Deterministic intent lowering in fixture mode. Nothing is installed until the
// normal compiler, tests, approval and MCP registration have completed.
export function planWorld(
  request: string,
  previous?: Capability,
): Capability | undefined {
  if (
    !isWorldRequest(request) &&
    !previous?.nodes.some((n) => n.operation in worldOperationSet)
  )
    return;
  if (/ignore previous|disable security|secret|shell|purchase/i.test(request))
    throw new Error("Unsafe world request: security bypass is unavailable");
  assertWorldRequestSupported(request);
  const extension =
    !!previous && /also|add|extend|more aggressively/i.test(request);
  const leaving = extension || /leaving|away|reduce.*energy/i.test(request);
  const welcome = /get home|come home|welcome home|hallway and bedroom/i.test(
    request,
  );
  const study = /\bstud(?:y|ying)\b|office.*computer|\bfocus(?:ing)?\b/i.test(
    request,
  );
  if (!leaving && !welcome && !study)
    throw new Error(
      "Describe leaving home, coming home at night, or a study routine using the available world devices.",
    );
  const nodes: WorkflowNode[] = extension
    ? structuredClone(previous.nodes)
    : [];
  const add = (
    operation: Operation,
    config: WorkflowNode["config"] = {},
    dependencies?: string[],
  ) => {
    const existing = nodes.find((n) => n.operation === operation);
    if (existing) {
      existing.config = { ...existing.config, ...config };
      if (dependencies) existing.dependsOn = dependencies;
      return existing.id;
    }
    const id = operation.replaceAll(".", "-");
    nodes.push({
      id,
      operation,
      label: operation,
      config,
      dependsOn: dependencies ?? (nodes.length ? [nodes.at(-1)!.id] : []),
      timeoutMs: 3000,
      maxAttempts: 1,
    });
    return id;
  };
  if (!extension) {
    add("presence.read");
    add("presence.set", { presence: leaving ? "away" : "home" });
    add("light.set", {
      rooms: leaving
        ? [...rooms]
        : welcome
          ? ["hallway", "bedroom"]
          : ["office"],
      on: !leaving,
    });
    if (leaving) {
      add("door.lock");
      add("computer.power", { on: false });
      add("appliance.power", { on: false });
    }
    if (study) {
      add("computer.power", { on: true });
      add("tv.power", { on: false });
    }
    if (!study) add("thermostat.set", { temperature: leaving ? 21 : 24 });
    add("energy.read");
  } else {
    const energy = nodes.find((n) => n.operation === "energy.read")!;
    const thermostat = nodes.find((n) => n.operation === "thermostat.set")!;
    const clock = add("clock.read", {}, [
      nodes.find((n) => n.operation === "presence.set")!.id,
    ]);
    const tv = add("tv.power", { on: false }, [
      nodes.find((n) => n.operation === "presence.set")!.id,
    ]);
    thermostat.config = {
      temperature: 18,
      minAwayMinutes: 30,
      fallbackTemperature: 21,
    };
    thermostat.dependsOn = [...new Set([...thermostat.dependsOn, clock, tv])];
    energy.dependsOn = [thermostat.id];
  }
  const id =
    previous?.id ??
    (leaving ? "leaving-home" : welcome ? "welcome-home" : "study-mode");
  const version = extension
    ? `${previous!.version.split(".")[0]}.${Number(previous!.version.split(".")[1]) + 1}.0`
    : "1.0.0";
  return validateCapability({
    id,
    name: leaving ? "Leaving Home" : welcome ? "Welcome Home" : "Study Mode",
    description: request,
    version,
    ...(extension ? { parentVersion: previous!.version } : {}),
    createdAt: new Date().toISOString(),
    intent: extension ? `${previous!.intent} ${request}` : request,
    trigger: "manual",
    toolContract: deriveToolContract(id, "manual"),
    nodes,
    edges: nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({ from, to: n.id })),
    ),
    permissions: derivePermissions(nodes),
    policies: {
      approvalRequired: true,
      network: "broker-only",
      maxRuntimeMs: 10000,
      maxToolCalls: 24,
      maxRepairAttempts: 1,
    },
    reason:
      "Composed from trusted world primitives in response to the owner's request.",
  });
}
const worldOperationSet = Object.fromEntries(
  [
    "presence.read",
    "presence.set",
    "light.set",
    "thermostat.set",
    "door.lock",
    "computer.power",
    "appliance.power",
    "tv.power",
    "energy.read",
  ].map((op) => [op, true]),
);
