import { deriveToolContract } from "./contracts";
import { derivePermissions, validateCapability, type Capability } from "./spec";

export const deadlineSource = `function execute(input: ModuleInput): ModuleOutput {
  const email = input.email;
  if (!input.trustedSenders.includes(email.from.toLowerCase())) return { change: null, notify: false };
  if (!/deadline (?:changed|moved) to/i.test(email.body)) return { change: null, notify: false };
  const match = email.body.match(/deadline (?:changed|moved) to (\\d{4}-\\d{2}-\\d{2})/i);
  if (!match) return { change: null, notify: false };
  const date = match[1];
  if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return { change: null, notify: false };
  const existing = input.events.find(event => event.title.toLowerCase() === email.subject.toLowerCase());
  if (existing && existing.date === date) return { change: null, notify: false };
  const days = (Date.parse(date) - Date.parse(email.at.slice(0,10))) / 86400000;
  return { change: { eventId: existing ? existing.id : null, title: email.subject, date }, notify: days >= 0 && days <= 7 };
}`;
export function planLive(
  request: string,
  previous?: Capability,
): Capability | undefined {
  if (!/deadline|professor|course schedule/i.test(request)) return;
  const ops = [
    "gmail.search",
    "calendar.list",
    "executable.run",
    "calendar.update",
    "calendar.create",
    "notification.emit",
  ] as const;
  const nodes = ops.map((operation, i) => ({
    id: `step-${i}`,
    operation,
    label: operation,
    config: {},
    dependsOn: i === 0 ? [] : [`step-${i - 1}`],
    timeoutMs: 5000,
    maxAttempts: 1,
  }));
  const id = previous?.id ?? "deadline-guardian";
  const version = previous
    ? `${previous.version.split(".")[0]}.${Number(previous.version.split(".")[1]) + 1}.0`
    : "1.0.0";
  return validateCapability({
    id,
    name: "Deadline Guardian",
    description:
      "Reconcile explicit deadline changes from approved senders through scoped Calendar operations.",
    intent: request,
    createdAt: new Date().toISOString(),
    version,
    ...(previous ? { parentVersion: previous.version } : {}),
    trigger: "scheduled",
    toolContract: deriveToolContract(id, "scheduled"),
    nodes,
    edges: nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({ from, to: n.id })),
    ),
    permissions: derivePermissions(nodes),
    policies: {
      approvalRequired: true,
      network: "broker-only",
      maxRuntimeMs: 30000,
      maxToolCalls: 10,
      maxRepairAttempts: 1,
    },
    reason: "Generated on request; begins with zero connector authority",
    executable: {
      interface: "deadline/v1",
      language: "typescript",
      source: deadlineSource,
    },
  });
}
