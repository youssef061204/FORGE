import { z } from "zod";
import { forge } from "@/server/forge";
import { body, handle, json } from "@/server/http";

const start = z.object({
  request: z.string().min(3).max(2000),
  fileIds: z.array(z.string().max(40)).max(8),
  drafts: z.number().int().min(1).max(8).optional(),
  extendToolId: z.string().max(40).optional(),
  examples: z.array(z.any()).max(20).optional(),
});

export async function GET(req: Request) {
  return handle(req, () => json({ builds: forge().repo.builds() }));
}

export async function POST(req: Request) {
  return handle(
    req,
    async () => {
      const b = await body(req, start);
      const id = await forge().builds.start(b);
      return json({ id });
    },
    { mutate: true },
  );
}
