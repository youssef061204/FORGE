/**
 * Behavioral clustering. Candidates whose outputs agree on the real data and
 * every variant are the same program as far as the user can tell. A clear
 * majority wins and is shown as "4 of 5 drafts agree", never as "correct".
 */
import { digest } from "../hash";
import type { Plan } from "../recipe/engine";
import { runPlan } from "../recipe/engine";
import type { Table } from "../table";
import type { Inputs, Variant } from "./variants";

export type Behavior = { variant: string; outcome: string; outputs?: Record<string, string> };

/** Canonical behavior on one input: output texts, or the error class. */
export function behave(plan: Plan, inputs: Inputs, now?: string): { outcome: string; outputs?: Record<string, string> } {
  try {
    const result = runPlan(plan, inputs, { now, workLimit: 2_000_000 });
    const outputs: Record<string, string> = {};
    for (const o of result.outputs) if (o.kind === "file") outputs[o.name] = o.value !== undefined ? JSON.stringify(sortKeys(o.value)) : o.text;
    return { outcome: digest(outputs), outputs };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return { outcome: `error:${code}` };
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as never)[k])]));
  return v;
}

export function fingerprint(behaviors: Behavior[]): string {
  return digest(behaviors.map((b) => [b.variant, b.outcome])).slice(0, 16);
}

export type Member = { id: string; fingerprint: string; behaviors: Behavior[] };
export type Group = { id: string; fingerprint: string; members: string[] };

export function clusterize(members: Member[]): Group[] {
  const groups = new Map<string, string[]>();
  for (const m of members) groups.set(m.fingerprint, [...(groups.get(m.fingerprint) ?? []), m.id]);
  return [...groups.entries()]
    .map(([fp, ids], i) => ({ id: `c${i + 1}`, fingerprint: fp, members: ids }))
    .sort((a, b) => b.members.length - a.members.length)
    .map((g, i) => ({ ...g, id: `c${i + 1}` }));
}

export type Verdict =
  | { kind: "winner"; group: Group; runnerUp?: Group }
  | { kind: "split"; groups: [Group, Group] }
  | { kind: "none" };

/**
 * A winner needs a strict lead. Two clusters within one vote of each other,
 * each with real support, are a material ambiguity worth asking about.
 */
export function decide(groups: Group[]): Verdict {
  if (!groups.length) return { kind: "none" };
  const [a, b] = groups;
  if (!b) return { kind: "winner", group: a };
  if (a.members.length - b.members.length >= 2 || (a.members.length >= 3 && b.members.length === 1)) return { kind: "winner", group: a, runnerUp: b };
  if (a.members.length === b.members.length || a.members.length - b.members.length === 1) return { kind: "split", groups: [a, b] };
  return { kind: "winner", group: a, runnerUp: b };
}

/** Early exit: three agree and no rival has two. */
export function settled(groups: Group[]): boolean {
  const [a, b] = groups;
  return !!a && a.members.length >= 3 && (!b || b.members.length < 2);
}

/**
 * Find the smallest input on which two programs disagree: start from the
 * first variant where they differ, then drop rows one at a time while they
 * still differ (greedy delta debugging).
 */
export function distinguishing(a: Plan, b: Plan, candidates: Variant[], now?: string): { variant: Variant; outA: Record<string, string>; outB: Record<string, string> } | undefined {
  const differs = (inputs: Inputs) => {
    const x = behave(a, inputs, now);
    const y = behave(b, inputs, now);
    return x.outcome !== y.outcome && x.outputs && y.outputs ? { x, y } : undefined;
  };
  const ordered = [...candidates].sort((p, q) => size(p.inputs) - size(q.inputs));
  for (const v of ordered) {
    if (!differs(v.inputs)) continue;
    let current: Inputs = structuredClone(v.inputs);
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (const slot of Object.keys(current)) {
        for (let i = 0; i < current[slot].rows.length; i++) {
          const trial: Inputs = { ...current, [slot]: { columns: current[slot].columns, rows: current[slot].rows.filter((_, j) => j !== i) } };
          if (differs(trial)) {
            current = trial;
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
    const d = differs(current)!;
    return { variant: { id: `${v.id}-min`, label: `smallest example from ${v.label}`, inputs: current }, outA: d.x.outputs!, outB: d.y.outputs! };
  }
  return undefined;
}

function size(inputs: Inputs) {
  return Object.values(inputs).reduce((n, t: Table) => n + t.rows.length, 0);
}
