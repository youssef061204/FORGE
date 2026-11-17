import { mcpToolName } from "@/core/contracts/tool-name";
import { eject } from "@/server/eject";
import { forge } from "@/server/forge";
import { guard, HttpError, json } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/tools/[id]/eject">) {
  try {
    guard(req);
  } catch (error) {
    return json({ error: (error as Error).message }, error instanceof HttpError ? error.status : 403);
  }
  const { id } = await ctx.params;
  const { repo } = forge();
  const tool = repo.tool(id);
  const v = tool?.currentVersion ? repo.version(id, tool.currentVersion) : undefined;
  if (!tool || !v) return json({ error: "No such tool." }, 404);
  const name = `${mcpToolName(tool.name, tool.id)}.mjs`;
  const text = await eject(v.recipe, name);
  return new Response(text, { headers: { "content-type": "text/javascript; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
