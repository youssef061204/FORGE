import { forge } from "@/server/forge";
import { guard, HttpError, json, sse } from "@/server/http";

export async function GET(req: Request) {
  try {
    guard(req);
  } catch (error) {
    return json({ error: (error as Error).message }, error instanceof HttpError ? error.status : 403);
  }
  const f = forge();
  return sse(req, (send) => f.bus.on((e) => send(e.t, e)));
}
