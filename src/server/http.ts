/**
 * HTTP guard and helpers for API routes.
 *
 * - The Host must be loopback, unless FORGE_OWNER_TOKEN is set and the request
 *   carries it (Authorization: Bearer <token>).
 * - Mutations must be same-origin JSON, which blocks cross-site form posts and
 *   DNS-rebinding pages from driving the API.
 * - Showcase mode is read-only.
 */
import { timingSafeEqual } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import { Denied } from "./broker/broker";
import { BuildError } from "./builds";
import { isShowcase } from "./forge";

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function tokenOk(req: Request): boolean {
  const token = process.env.FORGE_OWNER_TOKEN;
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function guard(req: Request, opts: { mutate?: boolean } = {}) {
  const host = req.headers.get("host") ?? "";
  const loopback = LOOPBACK_HOST.test(host);
  if (!loopback && !tokenOk(req)) throw new HttpError(403, "FORGE only answers this computer. Set FORGE_OWNER_TOKEN to allow other devices.");
  if (opts.mutate) {
    if (isShowcase()) throw new HttpError(403, "This is the showcase: nothing here changes anything. Run FORGE locally to build real tools.");
    const origin = req.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        /* invalid origin */
      }
      if (originHost !== host) throw new HttpError(403, "Cross-site requests are refused.");
    }
    if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "Send JSON.");
  }
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 12 * 1024 * 1024) throw new HttpError(413, "That request is too large.");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "The body isn't valid JSON.");
  }
  return schema.parse(raw);
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handle(req: Request, f: () => Promise<Response> | Response, opts: { mutate?: boolean } = {}): Promise<Response> {
  try {
    guard(req, opts);
    return await f();
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof BuildError) return json({ error: error.message }, error.status);
    if (error instanceof Denied) return json({ error: error.message, denied: error.layer }, 403);
    if (error instanceof ZodError) return json({ error: "The request didn't match what this endpoint expects.", issues: error.issues.slice(0, 5) }, 400);
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Something went wrong." }, 500);
  }
}

/** Server-Sent Events with replay from Last-Event-ID and a heartbeat. */
export function sse(req: Request, start: (send: (event: string, data: unknown, id?: number | string) => void) => (() => void) | void): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | void;
  let beat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown, id?: number | string) => {
        try {
          controller.enqueue(encoder.encode(`${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      cleanup = start(send);
      beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(beat);
        }
      }, 15_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(beat);
        cleanup?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(beat);
      cleanup?.();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
