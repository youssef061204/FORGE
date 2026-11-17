import { z } from "zod";
import { forge } from "@/server/forge";
import { body, handle, json } from "@/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/builds/[id]/answer">) {
  return handle(
    req,
    async () => {
      const { id } = await ctx.params;
      const { cluster } = await body(req, z.object({ cluster: z.string().max(20) }));
      forge().builds.answer(id, cluster);
      return json({ ok: true });
    },
    { mutate: true },
  );
}
