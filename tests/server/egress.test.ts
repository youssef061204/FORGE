import { readdirSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replay } from "../../src/core/events/reducer";
import { Broker } from "../../src/server/broker/broker";
import { BuildService } from "../../src/server/builds";
import { Bus } from "../../src/server/bus";
import { EgressBlocked, egressFetch, egressStats, isLoopbackUrl } from "../../src/server/egress";
import { SandboxPool } from "../../src/server/sandbox/pool";
import { ATTACKS, runAttack } from "../../src/server/safety/attacks";
import { openDatabase } from "../../src/server/store/db";
import { Repo } from "../../src/server/store/repo";
import { SAMPLES } from "../../src/showcase/samples";

process.env.FORGE_MODEL_TRANSPORT = "scripted";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

/** A double- or single-quoted string literal on one line. */
const STRING_LITERAL = new RegExp(String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`, "g");

const attempts: string[] = [];
const original = net.Socket.prototype.connect;

beforeAll(() => {
  // Record every socket the process opens while the tests below run.
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const opts = args[0] as { host?: string; port?: number; path?: string } | number;
    const host = typeof opts === "number" ? (args[1] as string | undefined) ?? "localhost" : (opts?.host ?? (opts?.path ? "ipc" : "localhost"));
    attempts.push(String(host));
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
});
afterAll(() => {
  net.Socket.prototype.connect = original;
});

describe("nothing leaves this machine", () => {
  it("egressFetch refuses every non-loopback host and counts the attempt", async () => {
    const before = egressStats().blocked;
    for (const url of ["https://example.com", "http://10.0.0.5:11434/api/tags", "http://169.254.169.254/latest", "http://127.0.0.1.nip.io/"])
      await expect(egressFetch(url)).rejects.toBeInstanceOf(EgressBlocked);
    expect(egressStats().blocked - before).toBe(4);
    expect(egressStats().external).toBe(0);
    expect(isLoopbackUrl("http://127.0.0.1:11435")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:3110")).toBe(true);
  });

  it("no source file outside server/egress.ts can open a connection", () => {
    const offenders: string[] = [];
    const patterns = [/\bfetch\s*\(/, /\bhttps?\.request\s*\(/, /\bnet\.connect\s*\(/, /\btls\.connect\s*\(/, /\bdgram\b/, /new\s+WebSocket\s*\(/, /\bXMLHttpRequest\b/, /navigator\.sendBeacon/];
    for (const f of files("src")) {
      const norm = f.replace(/\\/g, "/");
      if (norm.endsWith("server/egress.ts")) continue;
      // The browser may call its own server (/api/...), which CSP connect-src 'self' enforces.
      const browser = norm.includes("/ui/") || norm.startsWith("src/app/") && !norm.includes("/api/");
      // Strip string literals: attack payloads mention fetch() without calling it.
      const raw = readFileSync(f, "utf8");
      const text = raw.replace(STRING_LITERAL, '""');
      for (const p of patterns) {
        if (!p.test(text)) continue;
        if (browser && p.source.includes("fetch")) {
          // Only same-origin, relative URLs.
          const urls = [...raw.matchAll(/fetch\(\s*([`'"])(.*?)\1/g)].map((m) => m[2]);
          if (urls.every((u) => u.startsWith("/"))) continue;
        }
        offenders.push(`${norm}: ${p}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a full build, approval, run, revocation and all eleven attacks open only loopback sockets", async () => {
    const repo = new Repo(openDatabase(":memory:"));
    const bus = new Bus();
    const pool = new SandboxPool(1);
    const builds = new BuildService(repo, bus);
    const broker = new Broker(repo, pool, bus);
    try {
      const s = SAMPLES.find((x) => x.id === "orders")!;
      const file = repo.addFile(s.file.name, "csv", s.file.text);
      const id = await builds.start({ request: s.requests[0].text, fileIds: [file.id] });
      for (let i = 0; i < 400 && repo.build(id)?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 25));
      const view = replay(repo.events(id), id);
      const { tool } = builds.approve(id, { hash: view.review!.hash });
      await broker.run(tool.id, [{ slot: "orders", fileId: file.id }]);
      builds.revoke(tool.id);
      for (const a of ATTACKS) await runAttack(a.id);
    } finally {
      await pool.close();
    }
    const external = attempts.filter((h) => !["localhost", "127.0.0.1", "::1", "ipc"].includes(h));
    expect(external).toEqual([]);
    expect(egressStats().external).toBe(0);
  });
});
