import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { forge } from "@/server/forge";
import { body, handle, HttpError, json } from "@/server/http";

const schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(1).max(10080) }),
  z.object({ kind: z.literal("folder"), folder: z.string().min(1).max(400) }),
]);

export async function POST(req: Request, ctx: RouteContext<"/api/tools/[id]/schedule">) {
  return handle(
    req,
    async () => {
      const { id } = await ctx.params;
      const s = await body(req, schedule);
      const { repo } = forge();
      const tool = repo.tool(id);
      if (!tool) throw new HttpError(404, "No such tool.");
      if (s.kind === "folder") {
        const p = resolve(s.folder);
        if (!existsSync(p) || !statSync(p).isDirectory()) throw new HttpError(400, "That folder doesn't exist on this computer.");
      }
      repo.setSchedule(id, s);
      return json({ ok: true });
    },
    { mutate: true },
  );
}
