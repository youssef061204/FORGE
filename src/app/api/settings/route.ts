import { z } from "zod";
import { forge } from "@/server/forge";
import { body, handle, json } from "@/server/http";
import { modelStatus, selectModel } from "@/server/models";
import { forgeHome } from "@/server/store/db";
import { DEFAULT_LIMITS } from "@/core/contracts/passport";

export async function GET(req: Request) {
  return handle(req, async () => {
    const { status } = await modelStatus(true);
    const { repo } = forge();
    return json({
      model: status,
      memory: repo.setting("memory.enabled", true),
      learned: repo.memory().length,
      home: forgeHome(),
      limits: DEFAULT_LIMITS,
      customCode: process.env.FORGE_CUSTOM_CODE ?? "off",
    });
  });
}

export async function POST(req: Request) {
  return handle(
    req,
    async () => {
      const b = await body(req, z.object({ model: z.string().max(120).optional(), memory: z.boolean().optional() }));
      if (b.model) selectModel(b.model);
      if (b.memory !== undefined) forge().repo.setSetting("memory.enabled", b.memory);
      return json({ ok: true });
    },
    { mutate: true },
  );
}
