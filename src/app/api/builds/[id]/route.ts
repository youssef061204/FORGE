import { forge } from "@/server/forge";
import { handle, json, HttpError } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/builds/[id]">) {
  return handle(req, async () => {
    const { id } = await ctx.params;
    const f = forge();
    const build = f.repo.build(id);
    if (!build) throw new HttpError(404, "No such build.");
    return json({ build, events: f.repo.events(id) });
  });
}
