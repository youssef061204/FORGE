import { z } from "zod";
import { forge } from "@/server/forge";
import { body, handle, json } from "@/server/http";

const input = z.object({
  slot: z.string().max(40),
  fileId: z.string().max(40).optional(),
  inline: z
    .object({ name: z.string().max(120), format: z.enum(["csv", "tsv", "json", "text"]).optional(), text: z.string().max(10 * 1024 * 1024) })
    .optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/tools/[id]/run">) {
  return handle(
    req,
    async () => {
      const { id } = await ctx.params;
      const b = await body(req, z.object({ inputs: z.array(input).max(8), eventKey: z.string().max(200).optional() }));
      const out = await forge().broker.run(id, b.inputs, { eventKey: b.eventKey, trigger: "manual" });
      return json({ ...out, artifacts: out.artifacts.map(({ text, ...a }) => ({ ...a, preview: text.slice(0, 20000) })) });
    },
    { mutate: true },
  );
}
