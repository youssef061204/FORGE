import { isShowcase, mcpHub } from "@/server/forge";
import { guard, HttpError, json } from "@/server/http";

/** Streamable HTTP MCP endpoint: POST messages, GET the server stream, DELETE to end a session. */
async function handle(req: Request) {
  try {
    guard(req);
    if (isShowcase()) throw new HttpError(403, "The showcase has no MCP endpoint. Run FORGE locally to connect an assistant.");
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) throw new HttpError(403, "Cross-site requests are refused.");
  } catch (error) {
    return json({ error: (error as Error).message }, error instanceof HttpError ? error.status : 403);
  }
  return mcpHub().handle(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
