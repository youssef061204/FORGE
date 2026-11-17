import { z } from "zod";
import { assertAccess, readJson, HttpAccessError } from "@/forge/http";
import { getService } from "@/forge/server";
import { digest } from "@/forge/hash";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertAccess(request);
    const { batch } = z
      .object({
        batch: z.union([z.literal(100), z.literal(1000), z.literal(2048)]),
      })
      .strict()
      .parse(await readJson(request));
    const url = process.env.FORGE_GPU_BRIDGE_URL,
      token = process.env.FORGE_GPU_BRIDGE_TOKEN;
    if (!url || !token)
      return Response.json(
        {
          error:
            "Optional local CUDA bridge is not configured; GPU path is unavailable.",
        },
        { status: 503 },
      );
    const city = await getService().city.provider.observe();
    const input = {
      terrain: city.terrain,
      weather: city.weather,
      hazards: city.hazards.filter((h) => h.active),
    };
    const response = await fetch(new URL("/fields", url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        ...input,
        batch,
        seed: city.seed,
        observedFieldHash: digest(input),
      }),
      signal: AbortSignal.timeout(15000),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "GPU simulation failed" },
      { status: e instanceof HttpAccessError ? e.status : 400 },
    );
  }
}
