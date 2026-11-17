import { forge } from "@/server/forge";
import { handle, json } from "@/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/tools/[id]/revoke">) {
  return handle(
    req,
    async () => {
      const { id } = await ctx.params;
      forge().builds.revoke(id);
      return json({ ok: true });
    },
    { mutate: true },
  );
}
