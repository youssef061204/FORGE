import { z } from "zod";
import {
  validateCapability,
  derivePermissions,
  type Capability,
  type Operation,
  type WorkflowNode,
} from "./spec";
import type { ModelProvider, ModelUsage } from "./models";
import type { Release } from "./records";
import { digest } from "./hash";
import { deriveToolContract } from "./contracts";
import { assertWorldRequestSupported, isWorldRequest } from "./world";
import { planWorld } from "./world-planner";
import { planLive } from "./live-planner";

export type Resolution = Release["resolution"];
const terms = (text: string) =>
  text
    .toLowerCase()
    .replace(/internships/g, "internship")
    .match(/[a-z]+/g) ?? [];
export function similarity(a: string, b: string): number {
  const aa = new Set(terms(a));
  const bb = new Set(terms(b));
  const shared = [...aa].filter((t) => bb.has(t)).length;
  return shared / Math.sqrt(aa.size * bb.size || 1);
}
export function resolveCapability(
  request: string,
  installed: Capability[],
): { kind: Resolution; existing?: Capability; score: number } {
  installed = installed.filter(
    (cap) => cap.executable?.interface !== "city/v1",
  );
  // A deadline goal cannot extend a similarly worded career/household routine.
  // Keep unrelated installed tools intact when the registry already has capabilities.
  if (/deadline|professor|course schedule/i.test(request))
    installed = installed.filter(
      (cap) => cap.executable?.interface === "deadline/v1",
    );
  else if (/internship|job|resume|candidate|cover letter/i.test(request))
    installed = installed.filter((cap) => !cap.executable);
  const ranked = installed
    .map((existing) => ({
      existing,
      score: similarity(
        request,
        `${existing.intent} ${existing.name} ${existing.description}`,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const modification =
    /\b(also|add|modify|change|extend|cover letter|instead)\b/i.test(request);
  if (modification && installed.length) {
    const existing = /TV|nobody.*home|thermostat/i.test(request)
      ? (installed.find((c) => c.id === "leaving-home") ?? best?.existing)
      : /cover letter/i.test(request)
        ? installed.find((c) =>
            c.nodes.some((n) => n.operation === "candidate.match"),
          )
        : best?.existing;
    if (
      existing &&
      ((/internship|job|resume|candidate|cover letter|match threshold/i.test(
        request,
      ) &&
        existing.nodes.some((node) => node.operation === "candidate.match")) ||
        isWorldRequest(request) ||
        (best?.score ?? 0) > 0.2)
    )
      return { kind: "EXTEND", existing, score: best?.score ?? 0 };
  }
  if (
    best &&
    request.trim().toLowerCase() === best.existing.intent.trim().toLowerCase()
  )
    return { ...best, kind: "EXACT_MATCH" };
  if (best && best.score > 0.45) return { ...best, kind: "COMPOSE" };
  return { kind: "SYNTHESIZE", score: best?.score ?? 0 };
}
export function bump(version: string, part: "minor" | "patch"): string {
  const [major, minor, patch] = version.split(".").map(Number);
  return part === "minor"
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}
export function demoPlan(request: string, previous?: Capability): Capability {
  const live = planLive(request, previous);
  if (live) return live;
  const world = planWorld(request, previous);
  if (world) return world;
  if (
    /\b(send email|email.send|apply for|submit application|purchase|delete files|secret|shell|host command)\b/i.test(
      request,
    )
  )
    throw new Error(
      "This request requires a forbidden primitive. Installation is blocked.",
    );
  const nodes: WorkflowNode[] = [];
  const add = (
    id: string,
    operation: Operation,
    label: string,
    dependsOn: string[],
    config: WorkflowNode["config"] = {},
  ) =>
    nodes.push({
      id,
      operation,
      label,
      dependsOn,
      config,
      timeoutMs: 3000,
      maxAttempts: operation === "posting.read" ? 2 : 1,
    });
  let name = "Internship Scout";
  let trigger: Capability["trigger"] = "new_job_posting";
  const career = /internship|job|resume|candidate|cover letter/i.test(request);
  const notificationsAllowed =
    !/\b(?:do not|don't|never)\s+(?:notify|send notifications?|tell me)\b/i.test(
      request,
    );
  if (career) {
    add("retrieve-posting", "posting.read", "Read public posting", []);
    add(
      "normalize-posting",
      "posting.normalize",
      "Validate & normalize",
      ["retrieve-posting"],
      {
        schemaVersion:
          previous?.nodes.find((n) => n.operation === "posting.normalize")
            ?.config.schemaVersion ?? "v1",
      },
    );
    add("retrieve-resume", "resume.read", "Read resume", []);
    add("score-match", "candidate.match", "Compare requirements", [
      "normalize-posting",
      "retrieve-resume",
    ]);
    const priorThreshold = previous?.nodes.find(
      (n) => n.operation === "threshold.check",
    );
    const requestedCoverLetter = /cover letter|document/i.test(request);
    const requestedThreshold = Number(
      request.match(/(?:above|exceeds|over|least|>=)\s*(\d+)\s*%?/i)?.[1] ??
        previous?.nodes.find((n) => n.operation === "threshold.check")?.config
          .threshold ??
        75,
    );
    const threshold =
      previous && requestedCoverLetter
        ? (priorThreshold?.config.threshold ?? 75)
        : requestedThreshold;
    const requestedComparison = /(?:above|exceeds|over)\s*\d+/i.test(request)
      ? "gt"
      : (previous?.nodes.find((n) => n.operation === "threshold.check")?.config
          .comparison ?? "gte");
    const comparison =
      previous && requestedCoverLetter
        ? (priorThreshold?.config.comparison ?? "gte")
        : requestedComparison;
    add(
      "match-threshold",
      "threshold.check",
      `Match ${comparison === "gt" ? ">" : "≥"} ${threshold}%`,
      ["score-match"],
      { threshold, comparison },
    );
    if (
      requestedCoverLetter ||
      previous?.nodes.some((n) => n.operation === "cover_letter.generate")
    ) {
      add(
        "draft-cover-letter",
        "cover_letter.generate",
        `Draft letter ${requestedCoverLetter ? (requestedComparison === "gt" ? ">" : ">=") : previous?.nodes.find((n) => n.operation === "cover_letter.generate")?.config.comparison === "gt" ? ">" : ">="} ${requestedCoverLetter ? requestedThreshold : (previous?.nodes.find((n) => n.operation === "cover_letter.generate")?.config.threshold ?? 90)}%`,
        [
          "match-threshold",
          "score-match",
          "normalize-posting",
          "retrieve-resume",
        ],
        requestedCoverLetter
          ? { threshold: requestedThreshold, comparison: requestedComparison }
          : (previous?.nodes.find(
              (n) => n.operation === "cover_letter.generate",
            )?.config ?? { threshold: 90, comparison: "gt" }),
      );
      add("save-document", "document.write", "Save cover letter", [
        "draft-cover-letter",
        "match-threshold",
      ]);
    }
    if (notificationsAllowed)
      add("notify", "notification.send", "Deliver simulator notification", [
        "match-threshold",
        "score-match",
      ]);
  } else if (/summarize|uppercase|lowercase|transform/i.test(request)) {
    name = /summarize/i.test(request) ? "Briefing Maker" : "Text Transformer";
    trigger = /every|schedule|daily/i.test(request) ? "scheduled" : "manual";
    add(
      "transform-text",
      /summarize/i.test(request) ? "text.summarize" : "text.transform",
      name,
      [],
      {
        style: /uppercase/i.test(request)
          ? "uppercase"
          : /lowercase/i.test(request)
            ? "lowercase"
            : "concise",
      },
    );
    if (notificationsAllowed && /notify|tell me|notification/i.test(request))
      add("notify", "notification.send", "Deliver briefing", [
        "transform-text",
      ]);
  } else
    throw new Error(
      "Fixture mode supports leaving-home, welcome-home and study routines using the connected World devices, job monitoring, cover-letter extensions, text summaries and transformations. Describe one of those tasks. Bedrock mode can generate broader workflows using connected operations.",
    );
  const id =
    previous?.id ??
    (career
      ? "internship-scout"
      : `${name.toLowerCase().replaceAll(" ", "-")}-${digest(request).slice(0, 6)}`);
  return validateCapability({
    id,
    name: previous?.name ?? name,
    description: career
      ? "Monitor opportunities, compare requirements against a resume, and notify when the match qualifies."
      : request,
    version: previous ? bump(previous.version, "minor") : "1.0.0",
    ...(previous ? { parentVersion: previous.version } : {}),
    createdAt: new Date().toISOString(),
    intent: previous ? `${previous.intent} ${request}` : request,
    trigger,
    toolContract: deriveToolContract(id, trigger),
    nodes,
    edges: nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({ from, to: n.id })),
    ),
    permissions: derivePermissions(nodes),
    policies: {
      approvalRequired: true,
      network: "broker-only",
      maxRuntimeMs: 15000,
      maxToolCalls: 20,
      maxRepairAttempts: 3,
    },
    reason: previous ? request : "New capability requested in natural language",
  });
}
export async function compile(
  request: string,
  installed: Capability[],
  provider: ModelProvider,
  observe?: (stage: string) => void,
): Promise<{
  definition: Capability;
  resolution: Resolution;
  usage: ModelUsage;
  reusedNodes: string[];
}> {
  z.string().min(5).max(4000).parse(request);
  assertWorldRequestSupported(request);
  observe?.("Checking existing capabilities");
  const resolution = resolveCapability(request, installed);
  if (resolution.kind === "EXACT_MATCH")
    return {
      definition: resolution.existing!,
      resolution: resolution.kind,
      usage: {
        model: "registry",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
      },
      reusedNodes: [],
    };
  const previous =
    resolution.kind === "EXTEND" ? resolution.existing : undefined;
  observe?.("Creating ForgeSpec");
  const planned = await provider.generateStructured(request, previous);
  observe?.("Validating DAG and derived permissions");
  const definition = validateCapability(planned.value);
  if (
    previous &&
    (definition.id !== previous.id ||
      definition.version !== bump(previous.version, "minor") ||
      definition.parentVersion !== previous.version)
  )
    throw new Error("Invalid capability extension lineage");
  const source = resolution.existing;
  const reusedNodes: string[] = [];
  if ((resolution.kind === "COMPOSE" && source) || isWorldRequest(request)) {
    for (let i = 0; i < definition.nodes.length; i++) {
      const n = definition.nodes[i];
      const reusable = (
        isWorldRequest(request)
          ? installed.flatMap((c) => c.nodes)
          : source!.nodes
      ).find((p) => digest(p) === digest(n));
      if (reusable) {
        definition.nodes[i] = structuredClone(reusable);
        reusedNodes.push(n.id);
      }
    }
  }
  return {
    definition: validateCapability(definition),
    resolution:
      resolution.kind === "SYNTHESIZE" && isWorldRequest(request)
        ? "COMPOSE"
        : resolution.kind,
    usage: planned.usage,
    reusedNodes,
  };
}
