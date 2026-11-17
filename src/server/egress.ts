/**
 * The one door out. Every server-side HTTP request goes through egressFetch,
 * which only admits loopback addresses and counts what it lets through.
 * "0 requests left this machine" in the UI reads `blocked`/`external` here,
 * and tests/server/egress.test.ts fails if anything else opens a socket.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type Counter = { loopback: number; blocked: number; external: 0 };
const state = globalThis as typeof globalThis & { __forgeEgress?: Counter };
const counter: Counter = (state.__forgeEgress ??= { loopback: 0, blocked: 0, external: 0 });

export class EgressBlocked extends Error {
  constructor(host: string) {
    super(`Blocked a request to ${host}: FORGE only talks to this computer.`);
    this.name = "EgressBlocked";
  }
}

export function isLoopbackUrl(url: string | URL): boolean {
  try {
    const u = new URL(url);
    // Inside FORGE's own container the host machine is host.docker.internal:
    // still this computer, admitted only when compose.yaml says so.
    const dockerHost = process.env.FORGE_IN_DOCKER === "1" && u.hostname === "host.docker.internal";
    return (u.protocol === "http:" || u.protocol === "https:") && (LOOPBACK.has(u.hostname) || dockerHost);
  } catch {
    return false;
  }
}

export async function egressFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  if (!isLoopbackUrl(url)) {
    counter.blocked++;
    throw new EgressBlocked(new URL(url).host);
  }
  counter.loopback++;
  // Redirects could leave loopback; refuse them.
  const response = await fetch(url, { ...init, redirect: "error" });
  return response;
}

export function egressStats(): Readonly<Counter> {
  return { ...counter };
}
