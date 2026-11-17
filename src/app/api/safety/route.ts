import { z } from "zod";
import { body, handle, json } from "@/server/http";
import { ATTACKS, LAYERS, runAttack } from "@/server/safety/attacks";

export async function GET(req: Request) {
  return handle(req, () => json({ layers: LAYERS, attacks: ATTACKS.map(({ id, title, story, payload }) => ({ id, title, story, payload })) }));
}

/** Runs one attack against a scratch FORGE. It never touches your workspace. */
export async function POST(req: Request) {
  return handle(
    req,
    async () => {
      const { id } = await body(req, z.object({ id: z.string().max(60) }));
      return json(await runAttack(id));
    },
    { mutate: true },
  );
}
