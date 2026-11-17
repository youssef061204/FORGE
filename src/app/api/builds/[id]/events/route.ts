import { forge } from "@/server/forge";
import { guard, HttpError, json, sse } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/builds/[id]/events">) {
  try {
    guard(req);
  } catch (error) {
    return json({ error: (error as Error).message }, error instanceof HttpError ? error.status : 403);
  }
  const { id } = await ctx.params;
  const f = forge();
  if (!f.repo.build(id)) return json({ error: "No such build." }, 404);
  const header = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after");
  const last = header === null ? -1 : Number(header);
  return sse(req, (send) => {
    let sent = Number.isFinite(last) ? last : -1;
    const off = f.bus.onBuild(id, (e) => {
      if (e.seq <= sent) return;
      sent = e.seq;
      send("build", e, e.seq);
    });
    for (const e of f.repo.events(id, sent)) {
      sent = e.seq;
      send("build", e, e.seq);
    }
    return off;
  });
}
