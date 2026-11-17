import { timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
export class HttpAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 413,
  ) {
    super(message);
  }
}
export function assertAccess(request: Request) {
  const internalUrl = new URL(request.url);
  const config = getConfig();
  // Next's internal URL may normalize 127.0.0.1 to localhost. Compare browser Origin
  // against the actual validated Host, without trusting forwarded headers.
  const host = request.headers.get("host") ?? internalUrl.host;
  if (!/^[a-zA-Z0-9.\-:\[\]]+$/.test(host))
    throw new HttpAccessError("Invalid request host", 403);
  const url = new URL(`${internalUrl.protocol}//${host}`);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    throw new HttpAccessError("Cross-origin requests are forbidden", 403);
  const token = config.FORGE_API_TOKEN;
  if (token) {
    const supplied =
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const a = Buffer.from(supplied);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new HttpAccessError("Authentication required", 401);
  } else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new HttpAccessError(
      "Non-loopback access requires FORGE_API_TOKEN",
      401,
    );
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    throw new HttpAccessError("Request is too large", 413);
}
export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new HttpAccessError("Request is too large", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
