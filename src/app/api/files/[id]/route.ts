import { forge } from "@/server/forge";
import { handle, HttpError, json } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/files/[id]">) {
  return handle(req, async () => {
    const { id } = await ctx.params;
    const f = forge().repo.file(id);
    if (!f) throw new HttpError(404, "No such file.");
    return json({ file: f });
  });
}
