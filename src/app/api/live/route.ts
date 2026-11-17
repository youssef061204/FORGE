import { z } from "zod";
import { getService } from "@/forge/server";
import { assertAccess, readJson, HttpAccessError } from "@/forge/http";
import { serializeCapsule } from "@/forge/capsule";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const identity = {
  id: z.string().max(64),
  version: z.string().max(40),
  digest: z.string().length(64),
};
const connector = z.enum(["fixture", "google"]);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("replay"), ...identity, connector }).strict(),
  z
    .object({
      action: z.literal("promote"),
      ...identity,
      connector,
      mode: z.enum(["SHADOW", "LIVE"]),
      permissions: z.array(z.string()).max(14),
    })
    .strict(),
  z.object({ action: z.literal("run"), id: identity.id, connector }).strict(),
  z.object({ action: z.literal("revoke"), id: identity.id }).strict(),
  z.object({ action: z.literal("pause"), paused: z.boolean() }).strict(),
  z.object({ action: z.literal("connect"), writes: z.boolean() }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z
    .object({
      action: z.literal("export"),
      id: identity.id,
      version: identity.version,
    })
    .strict(),
  z.object({ action: z.literal("import"), capsule: z.unknown() }).strict(),
  z
    .object({
      action: z.literal("schedule"),
      id: identity.id,
      everySeconds: z.number().int().min(60).max(86400),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("delete_evidence") }).strict(),
]);
export async function GET(request: Request) {
  try {
    assertAccess(request);
    const service = getService();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const version = url.searchParams.get("version");
    return Response.json(
      {
        snapshot: await service.snapshot(),
        google: await service.google.status(),
        admission:
          id && version ? await service.admission(id, version) : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    assertAccess(request);
    const body = actions.parse(await readJson(request));
    const service = getService();
    let result;
    switch (body.action) {
      case "replay":
        result = await service.replay(
          body.id,
          body.version,
          body.digest,
          body.connector,
        );
        break;
      case "promote":
        result = await service.promote(
          body.id,
          body.version,
          body.digest,
          body.connector,
          body.mode,
          body.permissions,
        );
        break;
      case "run":
        result = await service.runConnected(body.id, body.connector);
        break;
      case "revoke":
        result = await service.revoke(body.id);
        break;
      case "pause":
        result = await service.pauseLive(body.paused);
        break;
      case "connect": {
        const flow = await service.google.begin(body.writes);
        return Response.json(
          { url: flow.url },
          {
            headers: {
              "Set-Cookie": `forge_oauth_state=${flow.state}; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=600${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
              "Cache-Control": "no-store",
            },
          },
        );
      }
      case "disconnect": {
        const state = await service.store.read();
        for (const release of state.releases)
          if (state.live?.trust[release.digest]?.connector === "google")
            await service.revoke(release.definition.id);
        await service.google.disconnect();
        result = { disconnected: true };
        break;
      }
      case "export":
        return new Response(
          serializeCapsule(await service.exportCapsule(body.id, body.version)),
          {
            headers: {
              "Content-Type": "application/vnd.forge.capability+json",
              "Content-Disposition": `attachment; filename="${body.id.replace(/[^a-z0-9-]/g, "")}-${body.version.replace(/[^0-9.]/g, "")}.forgecap"`,
              "Cache-Control": "no-store",
            },
          },
        );
      case "import":
        result = await service.importCapsule(body.capsule);
        break;
      case "schedule":
        result = await service.schedule(
          body.id,
          body.everySeconds,
          body.enabled,
        );
        break;
      case "delete_evidence":
        result = await service.deleteReplayEvidence();
        break;
    }
    return Response.json(
      { result, snapshot: await service.snapshot() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof z.ZodError
          ? "Invalid live request"
          : e instanceof Error
            ? e.message
            : "Live operation failed",
    },
    { status: e instanceof HttpAccessError ? e.status : 400 },
  );
}
