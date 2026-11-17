import { z } from "zod";
import { deriveToolContract } from "./contracts";
import {
  cityPermissions,
  cityActionNames,
  cityActionPermissions,
  goalContractSchema,
} from "./city-contracts";
import {
  livePermissions,
  liveOperations,
  liveOperationPermissions,
  executableSchema,
} from "./live-contracts";
import {
  rooms,
  worldPermissions,
  worldOperationPermissions,
  worldOperations,
} from "./world";

export const permissionSchema = z.enum([
  "public_web.read",
  "personal_resume.read",
  "documents.write",
  "notifications.write",
  ...worldPermissions,
  ...livePermissions,
  ...cityPermissions,
]);
export type Permission = z.infer<typeof permissionSchema>;
export const operations = [
  "posting.read",
  "resume.read",
  "posting.normalize",
  "candidate.match",
  "threshold.check",
  "cover_letter.generate",
  "document.write",
  "notification.send",
  "text.summarize",
  "text.transform",
  ...worldOperations,
  ...liveOperations,
  "city.observe",
  "city.apply",
] as const;
export const operationSchema = z.enum(operations);
export type Operation = z.infer<typeof operationSchema>;
export const operationPermissions: Partial<Record<Operation, Permission>> = {
  "posting.read": "public_web.read",
  "resume.read": "personal_resume.read",
  "document.write": "documents.write",
  "notification.send": "notifications.write",
  ...worldOperationPermissions,
  ...liveOperationPermissions,
  "city.observe": "city.read",
};
export const forbidden = [
  "email.send",
  "application.submit",
  "filesystem.delete",
  "calendar.write",
  "purchases.execute",
  "host.execute",
  "secrets.read",
] as const;
const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const nodeSchema = z
  .object({
    id: identifier,
    operation: operationSchema,
    label: z.string().min(1).max(100),
    dependsOn: z.array(identifier).max(24),
    config: z
      .object({
        threshold: z.number().min(0).max(100).optional(),
        comparison: z.enum(["gte", "gt"]).optional(),
        schemaVersion: z.enum(["v1", "v2"]).optional(),
        style: z.enum(["concise", "uppercase", "lowercase"]).optional(),
        rooms: z.array(z.enum(rooms)).min(1).max(5).optional(),
        on: z.boolean().optional(),
        temperature: z.number().min(16).max(28).optional(),
        fallbackTemperature: z.number().min(16).max(28).optional(),
        minAwayMinutes: z.number().int().min(0).max(1440).optional(),
        presence: z.enum(["home", "away"]).optional(),
        timeOfDay: z.enum(["day", "evening", "night"]).optional(),
        cityActions: z.array(z.enum(cityActionNames)).max(11).optional(),
      })
      .strict(),
    timeoutMs: z.number().int().min(50).max(15000),
    maxAttempts: z.number().int().min(1).max(3),
  })
  .strict();
export const capabilitySchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    parentVersion: z.string().optional(),
    createdAt: z.iso.datetime(),
    intent: z.string().min(1).max(4000),
    trigger: z.enum(["new_job_posting", "manual", "scheduled"]),
    toolContract: z
      .object({
        name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        inputSchema: z.record(z.string(), z.unknown()),
        outputSchema: z.record(z.string(), z.unknown()),
      })
      .strict(),
    nodes: z.array(nodeSchema).min(1).max(24),
    edges: z
      .array(z.object({ from: identifier, to: identifier }).strict())
      .max(100),
    permissions: z.array(permissionSchema).max(14),
    policies: z
      .object({
        approvalRequired: z.literal(true),
        network: z.literal("broker-only"),
        maxRuntimeMs: z.number().int().min(100).max(30000),
        maxToolCalls: z.number().int().min(1).max(40),
        maxRepairAttempts: z.number().int().min(0).max(3),
      })
      .strict(),
    reason: z.string().max(1000),
    executable: executableSchema.optional(),
    goal: goalContractSchema.optional(),
  })
  .strict();
export type Capability = z.infer<typeof capabilitySchema>;
export type WorkflowNode = Capability["nodes"][number];
export function derivePermissions(nodes: WorkflowNode[]): Permission[] {
  return [
    ...new Set(
      nodes.flatMap((n) =>
        n.operation === "city.apply"
          ? (n.config.cityActions ?? []).map((a) => cityActionPermissions[a])
          : operationPermissions[n.operation]
            ? [operationPermissions[n.operation]!]
            : [],
      ),
    ),
  ].sort();
}
export function topologicalOrder(capability: Capability): WorkflowNode[] {
  const visited = new Set<string>();
  const order: WorkflowNode[] = [];
  const nodes = new Map(capability.nodes.map((n) => [n.id, n]));
  if (nodes.size !== capability.nodes.length)
    throw new Error("Duplicate node identifier");
  const visiting = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Workflow contains a cycle");
    const node = nodes.get(id);
    if (!node) throw new Error(`Unknown dependency: ${id}`);
    visiting.add(id);
    node.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
    order.push(node);
  }
  capability.nodes.forEach((n) => visit(n.id));
  return order;
}
export function validateCapability(value: unknown): Capability {
  const cap = capabilitySchema.parse(value);
  const contract = deriveToolContract(cap.id, cap.trigger);
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  if (
    JSON.stringify(canonical(cap.toolContract)) !==
    JSON.stringify(canonical(contract))
  )
    throw new Error(
      "MCP tool contract must match the validated capability inputs and outputs",
    );
  topologicalOrder(cap);
  if (
    cap.nodes.some((n) => n.operation === "executable.run") !==
    Boolean(cap.executable)
  )
    throw new Error(
      "Executable artifact and executable.run must appear together",
    );
  if (
    cap.executable?.interface === "deadline/v1" &&
    (cap.nodes.length !== liveOperations.length ||
      cap.nodes.some(
        (n) =>
          !liveOperations.includes(
            n.operation as (typeof liveOperations)[number],
          ),
      ))
  )
    throw new Error(
      "deadline/v1 requires the complete scoped connector workflow",
    );
  if (
    cap.executable?.interface === "city/v1" &&
    (!cap.goal ||
      cap.nodes.length !== 3 ||
      !["city.observe", "executable.run", "city.apply"].every((op) =>
        cap.nodes.some((n) => n.operation === op),
      ) ||
      JSON.stringify(
        [
          ...(cap.nodes.find((n) => n.operation === "city.apply")?.config
            .cityActions ?? []),
        ].sort(),
      ) !== JSON.stringify([...cap.goal.actions].sort()))
  )
    throw new Error(
      "city/v1 requires a GoalContract and exact observe/execute/apply actuator manifest",
    );
  if (
    (cap.goal || cap.nodes.some((n) => n.operation.startsWith("city."))) &&
    cap.executable?.interface !== "city/v1"
  )
    throw new Error("City nodes require city/v1");
  if (new Set(cap.nodes.map((n) => n.operation)).size !== cap.nodes.length)
    throw new Error(
      "This runtime requires unique operations per workflow to keep data bindings unambiguous",
    );
  const expectedEdges = cap.nodes
    .flatMap((n) => n.dependsOn.map((from) => `${from}:${n.id}`))
    .sort();
  if (
    JSON.stringify(expectedEdges) !==
    JSON.stringify(cap.edges.map((e) => `${e.from}:${e.to}`).sort())
  )
    throw new Error("Edges must match node dependencies exactly");
  if (
    JSON.stringify(derivePermissions(cap.nodes)) !==
    JSON.stringify([...cap.permissions].sort())
  )
    throw new Error("Permission manifest must be the exact minimum");
  const ancestors = (id: string): WorkflowNode[] => {
    const node = cap.nodes.find((n) => n.id === id)!;
    const collected = new Map<string, WorkflowNode>();
    const visit = (dep: string) => {
      if (collected.has(dep)) return;
      const parent = cap.nodes.find((n) => n.id === dep)!;
      collected.set(dep, parent);
      parent.dependsOn.forEach(visit);
    };
    node.dependsOn.forEach(visit);
    return [...collected.values()];
  };
  for (const node of cap.nodes) {
    if (
      node.operation === "light.set" &&
      (!node.config.rooms || node.config.on === undefined)
    )
      throw new Error("light.set needs rooms and on");
    if (
      ["computer.power", "tv.power", "appliance.power"].includes(
        node.operation,
      ) &&
      node.config.on === undefined
    )
      throw new Error("Device power needs on");
    if (
      node.operation === "thermostat.set" &&
      node.config.temperature === undefined
    )
      throw new Error("thermostat.set needs a bounded temperature");
    if (node.operation === "presence.set" && !node.config.presence)
      throw new Error("presence.set needs presence");
    if (node.operation === "clock.set" && !node.config.timeOfDay)
      throw new Error("clock.set needs timeOfDay");
    const previous = ancestors(node.id).map((n) => n.operation);
    const required: Partial<Record<Operation, Operation[]>> = {
      "executable.run":
        cap.executable?.interface === "city/v1"
          ? ["city.observe"]
          : ["gmail.search", "calendar.list"],
      "city.apply": ["city.observe", "executable.run"],
      "calendar.update": ["executable.run"],
      "calendar.create": ["executable.run"],
      "notification.emit": ["executable.run"],
      "posting.normalize": ["posting.read"],
      "candidate.match": ["posting.normalize", "resume.read"],
      "threshold.check": ["candidate.match"],
      "cover_letter.generate": ["candidate.match", "threshold.check"],
      "document.write": ["cover_letter.generate", "threshold.check"],
    };
    if (
      node.config.minAwayMinutes !== undefined &&
      (!previous.includes("presence.read") || !previous.includes("clock.read"))
    )
      throw new Error(
        "Conditional thermostat needs presence.read and clock.read ancestors",
      );
    if (required[node.operation]?.some((op) => !previous.includes(op)))
      throw new Error(`Missing typed input for ${node.operation}`);
    if (
      node.operation === "notification.send" &&
      cap.trigger === "new_job_posting" &&
      !previous.includes("threshold.check")
    )
      throw new Error("Job notifications require a threshold gate");
  }
  return cap;
}
export const postingSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    company: z.string().min(1).max(200),
    requirements: z.array(z.string().min(1).max(200)).min(1).max(30),
    description: z.string().max(10000),
  })
  .strict();
export const resumeSchema = z
  .object({
    name: z.string(),
    skills: z.array(z.string()).min(1),
    experience: z.string(),
  })
  .strict();
export const eventSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(["new_job_posting", "manual", "scheduled"]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ForgeEvent = z.infer<typeof eventSchema>;
