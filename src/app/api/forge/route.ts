import { z } from "zod";
import { getService } from "@/forge/server";
import { assertAccess, readJson, HttpAccessError } from "@/forge/http";
import { postings } from "@/forge/fixtures";
import { eventSchema } from "@/forge/spec";
import { getConfig } from "@/forge/config";
import { logRequest } from "@/forge/telemetry";
import {
  CloudWatchAuditSink,
  EventBridgeEventBus,
  LocalEventBus,
} from "@/forge/aws";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("world_scene"),
      scene: z.enum(["active-day", "night-arrival", "away-45"]),
    })
    .strict(),
  z.object({ action: z.literal("world_attack") }).strict(),
  z.object({ action: z.literal("world_reset") }).strict(),
  z
    .object({
      action: z.literal("propose"),
      request: z.string().min(5).max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      id: z.string(),
      version: z.string(),
      digest: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      id: z.string(),
      version: z.string(),
      digest: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("trigger"),
      id: z.string(),
      fixture: z.enum(["amd", "irrelevant", "hostile", "changed"]),
      eventId: z.string().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("event"), id: z.string(), event: eventSchema })
    .strict(),
  z
    .object({
      action: z.literal("publish"),
      id: z.string(),
      event: eventSchema,
    })
    .strict(),
  z.object({ action: z.literal("repair"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("rollback"),
      id: z.string(),
      version: z.string(),
    })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    assertAccess(request);
    const buildId = new URL(request.url).searchParams.get("buildId");
    if (buildId) {
      const progress = getService().buildProgress(
        z.string().uuid().parse(buildId),
      );
      return Response.json(progress ?? { status: "pending" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(await getService().snapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  const started = performance.now();
  try {
    assertAccess(request);
    const body = actionSchema.parse(await readJson(request));
    const service = getService();
    let result;
    switch (body.action) {
      case "world_scene":
        result = await service.prepareWorld(body.scene);
        break;
      case "world_attack":
        result = await service.probeWorldSecurity();
        break;
      case "world_reset":
        result = await service.resetWorldDemo();
        break;
      case "propose":
        result = await service.propose(body.request);
        break;
      case "approve":
        result = await service.approve(body.id, body.version, body.digest);
        break;
      case "reject":
        result = await service.reject(body.id, body.version, body.digest);
        break;
      case "trigger":
        result = await service.trigger(body.id, {
          id: body.eventId ?? `demo-${body.fixture}-${crypto.randomUUID()}`,
          type: "new_job_posting",
          payload: { posting: postings[body.fixture] },
        });
        break;
      case "event":
        result = await service.trigger(body.id, body.event);
        break;
      case "publish": {
        const config = getConfig();
        const bus = config.FORGE_EVENT_BUS
          ? new EventBridgeEventBus(config.FORGE_EVENT_BUS)
          : new LocalEventBus((id, event) => service.trigger(id, event));
        result = { publishedEventId: await bus.publish(body.id, body.event) };
        break;
      }
      case "repair":
        result = await service.repair(body.id);
        break;
      case "rollback":
        result = await service.rollback(body.id, body.version);
        break;
    }
    const config = getConfig();
    logRequest({
      transport: "owner-api",
      method: body.action,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });
    if (config.FORGE_LOG_GROUP) {
      // Lifecycle is durable before optional log export. Surface export failure without replaying the action.
      try {
        await new CloudWatchAuditSink(config.FORGE_LOG_GROUP).write(
          body.action,
          {
            recordId: "id" in body ? body.id : "proposal",
            at: new Date().toISOString(),
          },
        );
      } catch {
        return Response.json({
          result,
          snapshot: await service.snapshot(),
          warning:
            "Action completed; CloudWatch audit export failed. Local audit is persisted.",
        });
      }
    }
    return Response.json({ result, snapshot: await service.snapshot() });
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  const message =
    e instanceof z.ZodError
      ? `Invalid request: ${e.issues.map((i) => i.message).join("; ")}`
      : e instanceof Error
        ? e.message
        : "Request failed";
  return Response.json(
    { error: message },
    {
      status: e instanceof HttpAccessError ? e.status : 400,
    },
  );
}
