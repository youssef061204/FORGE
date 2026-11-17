import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  operationPermissions,
  postingSchema,
  resumeSchema,
  type Capability,
  type ForgeEvent,
  type WorkflowNode,
} from "./spec";
import { resume } from "./fixtures";
import type { TraceStep } from "./records";
import type { StateStore } from "./store";
import { createWorld, energyKw, worldOperationPermissions } from "./world";
import { liveOperations } from "./live-contracts";
import { performLive, type LiveContext } from "./live-broker";
import { performCity, type CityContext } from "./environment";

export class PermissionDenied extends Error {
  constructor(permission: string) {
    super(`Permission denied: ${permission}`);
  }
}
export function authorize(cap: Capability, node: WorkflowNode) {
  const permission = operationPermissions[node.operation];
  if (permission && !cap.permissions.includes(permission))
    throw new PermissionDenied(permission);
  return permission;
}
export type Fault =
  "tool_failure" | "timeout" | "missing_resume" | "malformed_tool";
type Value = Record<string, unknown>;
export class PermissionBroker {
  readonly results = new Map<string, Value>();
  readonly trace: TraceStep[] = [];
  toolCalls = 0;
  permissionDenials = 0;
  private attempts = new Map<string, number>();
  constructor(
    readonly capability: Capability,
    readonly event: ForgeEvent,
    private store: StateStore,
    private fault?: Fault,
    private deadline = Date.now() + capability.policies.maxRuntimeMs,
    private liveContext?: LiveContext | CityContext,
  ) {}
  async invoke(nodeId: string, operation: string): Promise<Value> {
    const start = performance.now();
    const node = this.capability.nodes.find((n) => n.id === nodeId);
    if (!node || node.operation !== operation) {
      const worldPermission =
        worldOperationPermissions[
          operation as keyof typeof worldOperationPermissions
        ];
      this.permissionDenials++;
      const error = new PermissionDenied(
        operation === "external_http.write"
          ? "external_http.write (not granted)"
          : worldPermission
            ? `${worldPermission} (undeclared operation ${operation})`
            : "undeclared operation",
      );
      this.trace.push({
        nodeId,
        operation,
        status: "denied",
        permission:
          operation === "external_http.write"
            ? "external_http.write"
            : worldPermission,
        latencyMs: 0,
        attempts: 1,
        error: error.message,
        inputRefs: [],
        outputRef: "none",
      });
      throw error;
    }
    const attempt = (this.attempts.get(node.id) ?? 0) + 1;
    this.attempts.set(node.id, attempt);
    const step: TraceStep = {
      nodeId,
      operation,
      status: "success",
      latencyMs: 0,
      attempts: attempt,
      inputRefs: node.dependsOn.map((id) => `node:${id}`),
      outputRef: `node:${nodeId}`,
    };
    try {
      if (Date.now() >= this.deadline)
        throw new Error("Execution deadline exceeded");
      if (attempt > node.maxAttempts || this.results.has(node.id))
        throw new Error("Node attempt budget exceeded");
      step.permission = authorize(this.capability, node);
      if (++this.toolCalls > this.capability.policies.maxToolCalls)
        throw new Error("Tool budget exceeded");
      if (node.dependsOn.some((id) => !this.results.has(id)))
        throw new Error("Dependency not completed");
      if (
        node.dependsOn.some(
          (id) =>
            this.results.get(id)?.skipped === true ||
            this.results.get(id)?.allowed === false,
        )
      ) {
        step.status = "skipped";
        const result = { skipped: true };
        this.results.set(node.id, result);
        return result;
      }
      if (this.fault === "timeout" && node.id === this.capability.nodes[0].id)
        throw new Error("Tool timeout (controlled fixture)");
      if (
        this.fault === "tool_failure" &&
        node.operation === "posting.read" &&
        attempt === 1
      )
        throw new Error("Transient source failure (controlled fixture)");
      const result = await this.perform(node);
      if (result.skipped === true) step.status = "skipped";
      if (
        Date.now() > this.deadline ||
        performance.now() - start > node.timeoutMs
      )
        throw new Error("Node timeout exceeded");
      this.results.set(node.id, result);
      return result;
    } catch (error) {
      step.status = error instanceof PermissionDenied ? "denied" : "failed";
      if (error instanceof PermissionDenied) this.permissionDenials++;
      step.error = error instanceof Error ? error.message : "Tool failed";
      throw error;
    } finally {
      step.latencyMs = Math.round((performance.now() - start) * 100) / 100;
      this.trace.push(step);
    }
  }
  private byOperation(operation: string): Value {
    const node = this.capability.nodes.find((n) => n.operation === operation);
    return node ? (this.results.get(node.id) ?? {}) : {};
  }
  private async perform(node: WorkflowNode): Promise<Value> {
    if (
      this.liveContext &&
      "kind" in this.liveContext &&
      this.liveContext.kind === "city"
    )
      return performCity(this.capability, node, this.liveContext);
    if (
      liveOperations.includes(node.operation as (typeof liveOperations)[number])
    )
      return performLive(
        node,
        this.capability,
        this.event,
        this.store,
        this.liveContext as LiveContext | undefined,
      );
    switch (node.operation) {
      case "posting.read": {
        if (this.fault === "malformed_tool") return { posting: { title: 42 } };
        const raw = this.event.payload.posting;
        z.record(z.string(), z.unknown()).parse(raw);
        return { posting: raw };
      }
      case "posting.normalize": {
        let raw = this.byOperation("posting.read").posting;
        if (node.config.schemaVersion === "v2") {
          const changed = z
            .object({
              postingId: z.string(),
              role: z.string(),
              employer: z.string(),
              skills: z.array(z.string()),
              body: z.string(),
            })
            .safeParse(raw);
          if (changed.success)
            raw = {
              id: changed.data.postingId,
              title: changed.data.role,
              company: changed.data.employer,
              requirements: changed.data.skills,
              description: changed.data.body,
            };
        }
        const parsed = postingSchema.safeParse(raw);
        if (!parsed.success)
          throw new Error(
            "SOURCE_SCHEMA_CHANGED: posting does not match the installed schema",
          );
        // External content never controls operation selection, permissions or tool arguments.
        return { posting: parsed.data, untrustedContent: true };
      }
      case "resume.read": {
        if (this.fault === "missing_resume")
          throw new Error("Resume unavailable");
        return { resume: resumeSchema.parse(resume) };
      }
      case "candidate.match": {
        const job = postingSchema.parse(
          this.byOperation("posting.normalize").posting,
        );
        const candidate = resumeSchema.parse(
          this.byOperation("resume.read").resume,
        );
        const strengths = job.requirements.filter((r) =>
          candidate.skills.some((s) => s.toLowerCase() === r.toLowerCase()),
        );
        const gaps = job.requirements.filter((r) => !strengths.includes(r));
        return {
          matchScore: Math.round(
            (100 * strengths.length) / job.requirements.length,
          ),
          strengths,
          gaps,
          confidence: "structured-skill-overlap",
          company: job.company,
          title: job.title,
        };
      }
      case "threshold.check": {
        const score = z
          .number()
          .min(0)
          .max(100)
          .parse(this.byOperation("candidate.match").matchScore);
        const threshold = node.config.threshold ?? 75;
        return {
          allowed:
            node.config.comparison === "gt"
              ? score > threshold
              : score >= threshold,
          threshold,
          comparison: node.config.comparison ?? "gte",
        };
      }
      case "cover_letter.generate": {
        const score = z
          .number()
          .parse(this.byOperation("candidate.match").matchScore);
        const threshold = node.config.threshold ?? 90;
        if (
          !(node.config.comparison === "gte"
            ? score >= threshold
            : score > threshold)
        )
          return { skipped: true, reason: "Cover-letter threshold not met" };
        const job = postingSchema.parse(
          this.byOperation("posting.normalize").posting,
        );
        const candidate = resumeSchema.parse(
          this.byOperation("resume.read").resume,
        );
        const strengths = z
          .array(z.string())
          .parse(this.byOperation("candidate.match").strengths);
        return {
          text: `Dear ${job.company} hiring team,\n\nI am applying for the ${job.title} position. My experience with ${strengths.join(", ")} aligns with your stated requirements. ${candidate.experience}\n\nI would welcome the opportunity to contribute and discuss how these skills can support your team.\n\nSincerely,\n${candidate.name}`,
        };
      }
      case "document.write":
        return this.effect(
          node,
          "document",
          z
            .string()
            .max(20000)
            .parse(this.byOperation("cover_letter.generate").text),
        );
      case "notification.send": {
        const match = this.byOperation("candidate.match");
        const text =
          match.matchScore !== undefined
            ? `${match.company}: ${match.title} — ${match.matchScore}% skills match. Review the strengths and gaps before deciding to apply.`
            : String(
                this.byOperation("text.summarize").text ??
                  this.byOperation("text.transform").text ??
                  "Workflow completed.",
              );
        return this.effect(node, "notification", text);
      }
      case "text.summarize": {
        const text = z
          .string()
          .min(1)
          .max(10000)
          .parse(this.event.payload.text);
        return {
          text: text
            .split(/(?<=[.!?])\s+/)
            .slice(0, 2)
            .join(" ")
            .slice(0, 500),
          method: "extractive",
        };
      }
      case "text.transform": {
        const text = z
          .string()
          .min(1)
          .max(10000)
          .parse(this.event.payload.text);
        return {
          text:
            node.config.style === "uppercase"
              ? text.toUpperCase()
              : node.config.style === "lowercase"
                ? text.toLowerCase()
                : text.trim(),
        };
      }
      default:
        return this.performWorld(node);
    }
  }
  private async performWorld(node: WorkflowNode): Promise<Value> {
    // The event is an invocation label, never an instruction source. Config is
    // taken exclusively from the digest-checked approved ForgeSpec.
    z.string().min(1).max(10000).parse(this.event.payload.text);
    if (!(node.operation in worldOperationPermissions))
      throw new Error("Unknown world operation");
    const key = `${this.capability.id}:${this.event.id}:${node.id}`;
    const read = node.operation.endsWith(".read");
    const execute = (state: Awaited<ReturnType<StateStore["read"]>>): Value => {
      const world = state.world ?? createWorld();
      const config = node.config;
      switch (node.operation) {
        case "presence.read":
          return {
            presence: world.presence,
            awayMinutes:
              world.awaySince === null ? 0 : world.minute - world.awaySince,
          };
        case "light.read":
          return { lights: structuredClone(world.lights) };
        case "door.read":
          return { locked: world.doorLocked };
        case "thermostat.read":
          return { temperature: world.temperature };
        case "computer.read":
          return { on: world.computerOn };
        case "tv.read":
          return { on: world.tvOn };
        case "appliance.read":
          return { on: world.appliancesOn };
        case "clock.read":
          return { timeOfDay: world.timeOfDay, minute: world.minute };
        case "mailbox.read":
          return { messages: [...world.mailbox], untrustedContent: true };
        case "energy.read":
          return {
            energyKw: energyKw(world),
            method: "simulated-device-loads",
          };
        case "security.read":
          return { doorLocked: world.doorLocked, alert: world.alert };
      }
      if (state.effects[key]) return { effectId: key, deduplicated: true };
      switch (node.operation) {
        case "light.set":
          for (const room of config.rooms!) world.lights[room] = config.on!;
          break;
        case "door.lock":
          world.doorLocked = true;
          break;
        case "door.unlock":
          world.doorLocked = false;
          break;
        case "thermostat.set": {
          const eligible =
            config.minAwayMinutes === undefined ||
            (world.presence === "away" &&
              world.awaySince !== null &&
              world.minute - world.awaySince >= config.minAwayMinutes);
          if (eligible) world.temperature = config.temperature!;
          else if (config.fallbackTemperature !== undefined)
            world.temperature = config.fallbackTemperature;
          break;
        }
        case "computer.power":
          world.computerOn = config.on!;
          break;
        case "tv.power":
          world.tvOn = config.on!;
          break;
        case "appliance.power":
          world.appliancesOn = config.on!;
          break;
        case "presence.set":
          if (config.presence !== world.presence)
            world.awaySince = config.presence === "away" ? world.minute : null;
          world.presence = config.presence!;
          break;
        case "clock.set":
          world.timeOfDay = config.timeOfDay!;
          break;
        default:
          throw new Error("Unknown world write");
      }
      state.world = world;
      state.effects[key] = {
        kind: "world",
        content: node.operation,
        createdAt: new Date().toISOString(),
        capabilityId: this.capability.id,
        eventId: this.event.id,
      };
      return {
        effectId: key,
        operation: node.operation,
        energyKw: energyKw(world),
        deduplicated: false,
      };
    };
    return read
      ? execute(await this.store.read())
      : this.store.transaction(execute);
  }
  private async effect(
    node: WorkflowNode,
    kind: "document" | "notification",
    content: string,
  ): Promise<Value> {
    const key = `${this.capability.id}:${this.event.id}:${node.id}`;
    return this.store.transaction((state) => {
      const existing = state.effects[key];
      if (existing) return { effectId: key, kind, deduplicated: true };
      state.effects[key] = {
        kind,
        content,
        createdAt: new Date().toISOString(),
        capabilityId: this.capability.id,
        eventId: this.event.id,
      };
      return { effectId: key, kind, deduplicated: false };
    });
  }
}
