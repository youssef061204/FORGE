/**
 * Routing, mostly by rule. The model proposes which capabilities a request
 * needs; a small lexicon of action phrases backs it up, so "email this to my
 * manager" can never be quietly turned into a saved file. A required
 * capability that isn't connected ends the build as CONNECT, with no program.
 */
import { CAPABILITIES, isConnected, type CapabilityId } from "../contracts/capabilities";
import type { Route } from "../events/types";

const ACTIONS: { id: CapabilityId; patterns: RegExp[] }[] = [
  {
    id: "email.send",
    patterns: [
      /\b(send|e-?mail|forward|mail)\b[^.]{0,60}\b(to|at)\s+[\w.+-]+@[\w-]+\.[\w.]+/i,
      /\bsend\b[^.]{0,40}\b(an? )?(e-?mail|message)\b/i,
      /\b(e-?mail|mail) (it|this|them|the \w+) to\b/i,
      /\bas an? (e-?mail )?attachment\b/i,
      /\bemail (sending )?provider\b/i,
    ],
  },
  { id: "email.read", patterns: [/\b(my|the) (inbox|gmail|outlook)\b/i, /\bread (my )?e-?mails?\b/i] },
  {
    id: "calendar.create",
    patterns: [
      /\b(create|add|put|schedule|book)\b[^.]{0,50}\b(on|in|to) (my |the )?(google )?calendar\b/i,
      /\bcalendar (event|invite|entry)\b/i,
    ],
  },
  { id: "calendar.read", patterns: [/\b(read|check|look at) (my )?calendar\b/i] },
  {
    id: "web.fetch",
    patterns: [/\b(fetch|download|scrape|crawl|pull)\b[^.]{0,40}\b(https?:\/\/|website|web page|the web|internet|url)\b/i, /\bhttps?:\/\/\S+/i],
  },
  { id: "chat.post", patterns: [/\b(post|send|message)\b[^.]{0,40}\b(slack|discord|teams|telegram|whatsapp)\b/i] },
  { id: "sms.send", patterns: [/\b(text message|sms)\b/i, /\btext (it|them|me)\b/i] },
  { id: "sheet.write", patterns: [/\b(google sheets?|update (my|the) (online )?spreadsheet)\b/i] },
  { id: "drive.upload", patterns: [/\bupload\b[^.]{0,40}\b(drive|dropbox|s3|onedrive|icloud)\b/i] },
  { id: "payment.send", patterns: [/\b(pay|transfer|send)\b[^.]{0,30}\b(money|payment|\$\d|invoice to)\b/i] },
];

/** Capabilities a request clearly asks for, from its wording alone. */
export function lexicalNeeds(request: string): CapabilityId[] {
  const found = new Set<CapabilityId>();
  for (const a of ACTIONS) if (a.patterns.some((p) => p.test(request))) found.add(a.id);
  // "do not send messages" or "don't email" is a prohibition, not a need.
  for (const id of [...found]) {
    const negated = new RegExp(`\\b(do not|don't|never|without)\\b[^.]{0,30}\\b(${id === "email.send" ? "send|e-?mail|message" : id.split(".")[0]})`, "i");
    if (negated.test(request) && !ACTIONS.find((a) => a.id === id)!.patterns.some((p) => p.test(request.replace(negated, ""))))
      found.delete(id);
  }
  return [...found];
}

export type RouteInput = {
  request: string;
  modelNeeds: CapabilityId[];
  feasible: boolean;
  missing: string;
  files: number;
  enabled?: Partial<Record<CapabilityId, boolean>>;
  reuse?: { toolId: string; name: string };
  extend?: { toolId: string; name: string };
};
export type RouteDecision = { route: Route; reason: string; missing?: CapabilityId[]; question?: string; toolId?: string };

/** Words that must appear before a model's claim of an unconnected need is believed. */
const FAMILY: Partial<Record<CapabilityId, RegExp>> = {
  "email.send": /\b(e-?mail|mail|inbox|send|forward)\b/i,
  "email.read": /\b(e-?mail|mail|inbox|gmail|outlook)\b/i,
  "calendar.create": /\b(calendar|invite|schedule|appointment|meeting)\b/i,
  "calendar.read": /\bcalendar\b/i,
  "web.fetch": /\b(https?:|www\.|website|web|internet|online|url|api|fetch|download)\b/i,
  "chat.post": /\b(slack|discord|teams|telegram|whatsapp|chat|channel)\b/i,
  "sms.send": /\b(sms|text message|phone|text me)\b/i,
  "sheet.write": /\b(google sheets?|online spreadsheet|sheets|excel online)\b/i,
  "drive.upload": /\b(drive|dropbox|onedrive|icloud|s3|upload|cloud)\b/i,
  "payment.send": /\b(pay|payment|transfer|money|wire)\b/i,
};

export function decideRoute(input: RouteInput): RouteDecision {
  // The model's list is advisory for unconnected capabilities: it must be
  // corroborated by the request's own words, or it is dropped.
  const corroborated = input.modelNeeds.filter((n) => n in CAPABILITIES && (isConnected(n, input.enabled) || FAMILY[n]?.test(input.request)));
  const needs = new Set<CapabilityId>([...corroborated, ...lexicalNeeds(input.request)]);
  const missing = [...needs].filter((n) => !isConnected(n, input.enabled));
  if (missing.length)
    return {
      route: "CONNECT",
      missing,
      reason: `This needs ${missing.map((m) => CAPABILITIES[m].label.toLowerCase()).join(" and ")}, which isn't connected. FORGE won't substitute a file for it or claim it happened.`,
    };
  if (!input.feasible)
    return { route: "UNSUPPORTED", reason: input.missing || "This isn't something a data recipe can do: recipes read your files and compute results, nothing more." };
  if (input.reuse) return { route: "REUSE", toolId: input.reuse.toolId, reason: `${input.reuse.name} already does this. No new program is needed.` };
  if (input.files === 0)
    return { route: "CLARIFY", question: "Which file should the tool work on? Drop one in or pick a sample.", reason: "No input file is attached yet." };
  if (input.extend) return { route: "EXTEND", toolId: input.extend.toolId, reason: `Changing ${input.extend.name}. The new version will need its own approval.` };
  return { route: "SYNTHESIZE", reason: "A new tool is needed. FORGE will draft several programs and test them against your data." };
}

/** Normalized request text for exact-reuse matching. */
export function requestKey(request: string): string {
  return request.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

const EDIT_HINT = /\b(update|change|modify|edit|adjust|extend|tweak|instead|also|now make|make it)\b/i;
/** An explicit edit of an existing tool: names it, or edits the last one. */
export function findExtendTarget(request: string, tools: { toolId: string; name: string }[], lastToolId?: string) {
  const lower = request.toLowerCase();
  const named = tools.find((t) => lower.includes(t.name.toLowerCase()));
  if (named && EDIT_HINT.test(request)) return named;
  if (lastToolId && /\b(the|this|that) (\w+ )?tool\b/i.test(request) && EDIT_HINT.test(request)) return tools.find((t) => t.toolId === lastToolId);
  return undefined;
}
