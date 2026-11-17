import { z } from "zod";
import { forge } from "@/server/forge";
import { body, handle, json } from "@/server/http";

const read = z.object({
  kind: z.literal("read"),
  slot: z.string().max(40),
  scope: z.enum(["exact-file", "any-file", "watched-folder"]),
  file: z.string().max(120).optional(),
  folder: z.string().max(400).optional(),
});

/** Approval is a person in the FORGE UI. No MCP path reaches this handler. */
export async function POST(req: Request, ctx: RouteContext<"/api/builds/[id]/approve">) {
  return handle(
    req,
    async () => {
      const { id } = await ctx.params;
      const b = await body(req, z.object({ hash: z.string().length(64), scopes: z.record(z.string(), read).optional() }));
      const { tool, version } = forge().builds.approve(id, b);
      return json({ toolId: tool.id, version: version.version });
    },
    { mutate: true },
  );
}
