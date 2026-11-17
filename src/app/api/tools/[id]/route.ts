import { forge } from "@/server/forge";
import { handle, HttpError, json } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/tools/[id]">) {
  return handle(req, async () => {
    const { id } = await ctx.params;
    const { repo } = forge();
    const tool = repo.tool(id);
    if (!tool) throw new HttpError(404, "No such tool.");
    const lastFiles = tool.lastFileIds
      .map((f) => repo.file(f))
      .filter((f) => !!f)
      .map((f) => ({ id: f.id, name: f.name, format: f.format, bytes: f.bytes }));
    return json({ tool, versions: repo.versions(id), runs: repo.runs(id, 30), receipts: repo.receipts(id, 60), lastFiles });
  });
}
