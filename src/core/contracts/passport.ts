/**
 * The permission passport: exactly what an approved tool may do, what it
 * cannot do, and what changed since the previous version. Derived from the
 * recipe, never written by a model.
 */
import type { Recipe } from "../recipe/schema";

export type SlotScope = "exact-file" | "any-file" | "watched-folder";
export type Grant =
  | { kind: "read"; slot: string; scope: SlotScope; file?: string; folder?: string }
  | { kind: "write"; output: string; maxBytes: number }
  | { kind: "view"; name: string };

export type Passport = {
  can: { grant: Grant; text: string }[];
  cannot: string[];
  limits: { maxInputBytes: number; maxRows: number; maxMs: number };
  executes: "recipe" | "custom-code";
  delta?: { added: string[]; removed: string[] };
};

export const DEFAULT_LIMITS = { maxInputBytes: 10 * 1024 * 1024, maxRows: 100_000, maxMs: 5_000 };
export const DEFAULT_OUTPUT_BYTES = 10 * 1024 * 1024;

function grantText(g: Grant): string {
  if (g.kind === "read") {
    if (g.scope === "exact-file") return `Read ${g.file ?? g.slot}, and only that file`;
    if (g.scope === "watched-folder") return `Read new files that appear in ${g.folder ?? "the watched folder"}`;
    return `Read the ${g.slot} file you hand it each time it runs`;
  }
  if (g.kind === "write") return `Save ${g.output} (up to ${formatBytes(g.maxBytes)})`;
  return `Show “${g.name}” on its dashboard`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
}

export function defaultGrants(recipe: Recipe, files: Record<string, string | undefined> = {}): Grant[] {
  const grants: Grant[] = recipe.inputs.map((i) => ({
    kind: "read",
    slot: i.slot,
    scope: "any-file",
    ...(files[i.slot] ? { file: files[i.slot] } : {}),
  }));
  for (const o of recipe.outputs) {
    if (o.kind === "file") grants.push({ kind: "write", output: o.name, maxBytes: DEFAULT_OUTPUT_BYTES });
    else grants.push({ kind: "view", name: o.title ?? `${o.type} chart` });
  }
  return grants;
}

export function grantKey(g: Grant): string {
  if (g.kind === "read") return `read:${g.slot}:${g.scope}${g.file ? ":" + g.file : ""}${g.folder ? ":" + g.folder : ""}`;
  if (g.kind === "write") return `write:${g.output}:${g.maxBytes}`;
  return `view:${g.name}`;
}

export function passportFor(grants: Grant[], previous?: Grant[], executes: Passport["executes"] = "recipe"): Passport {
  const cannot = [
    "Use the network",
    "Read any file you didn't hand it",
    "Change or delete your files",
    executes === "recipe" ? "Run code written by a model" : "Run outside its locked sandbox",
    "Keep running forever",
  ];
  const passport: Passport = {
    can: grants.map((grant) => ({ grant, text: grantText(grant) })),
    cannot,
    limits: { ...DEFAULT_LIMITS },
    executes,
  };
  if (previous) {
    const before = new Set(previous.map(grantKey));
    const after = new Set(grants.map(grantKey));
    passport.delta = {
      added: grants.filter((g) => !before.has(grantKey(g))).map(grantText),
      removed: previous.filter((g) => !after.has(grantKey(g))).map(grantText),
    };
  }
  return passport;
}
