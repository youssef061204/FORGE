import { z } from "zod";
import { assertAccess, readJson, HttpAccessError } from "@/forge/http";
import { getProduct, importConnection } from "@/forge/product/server";
import {
  importWorkspaceDocument,
  readWorkspaceArtifact,
} from "@/forge/product/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ask"),
      goal: z.string().min(5).max(4000),
      buildId: z.string().uuid().optional(),
      followUpId: z.string().max(64).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      id: z.string(),
      hash: z.string().length(64),
      permissions: z.array(z.string()).max(32),
    })
    .strict(),
  z
    .object({
      action: z.literal("run"),
      id: z.string(),
      eventId: z.string().min(1).max(200).optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum([
        "pause",
        "resume",
        "revoke",
        "reject",
        "rollback",
        "recheck",
      ]),
      id: z.string(),
      hash: z.string().length(64),
    })
    .strict(),
  z.object({ action: z.literal("import"), connection: z.unknown() }).strict(),
  z
    .object({
      action: z.literal("upload"),
      name: z.string().min(1).max(80),
      format: z.enum(["csv", "text", "json"]),
      text: z.string().max(16384),
    })
    .strict(),
  z
    .object({
      action: z.literal("event"),
      id: z.string().max(64),
      connector: z.string().max(48),
      event: z.string().max(100),
      eventId: z.string().min(1).max(200),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof z.ZodError
          ? "The request does not match the expected format"
          : error instanceof Error
            ? error.message
            : "The request stopped before completion",
    },
    { status: error instanceof HttpAccessError ? error.status : 400 },
  );
}
export async function GET(request: Request) {
  try {
    assertAccess(request);
    const product = await getProduct();
    const id = new URL(request.url).searchParams.get("buildId");
    const artifactId = new URL(request.url).searchParams.get("artifact");
    if (artifactId) {
      const artifact = await readWorkspaceArtifact(product.store, artifactId);
      return new Response(artifact.text, {
        headers: {
          "Content-Type":
            artifact.format === "json"
              ? "application/json; charset=utf-8"
              : artifact.format === "csv"
                ? "text/csv; charset=utf-8"
                : "text/plain; charset=utf-8",
          "Content-Disposition":
            "attachment; filename*=UTF-8''" + encodeURIComponent(artifact.name),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return Response.json(
      id
        ? { progress: product.progress(id) ?? null }
        : await product.snapshot(),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    assertAccess(request);
    const command = actionSchema.parse(await readJson(request));
    const product = await getProduct();
    if (command.action === "ask")
      return Response.json(
        await product.ask(command.goal, command.buildId, command.followUpId),
      );
    if (command.action === "upload")
      return Response.json(
        await importWorkspaceDocument(product.store, {
          name: command.name,
          format: command.format,
          text: command.text,
        }),
      );
    if (command.action === "approve")
      return Response.json(
        await product.approve(command.id, command.hash, command.permissions),
      );
    if (command.action === "run")
      return Response.json(
        await product.run(command.id, command.eventId, command.input),
      );
    if (command.action === "import")
      return Response.json(await importConnection(command.connection));
    if (command.action === "event")
      return Response.json(
        await product.deliverEvent(
          command.id,
          command.connector,
          command.event,
          command.eventId,
          command.input,
        ),
      );
    if (command.action === "rollback")
      return Response.json(await product.rollback(command.id, command.hash));
    if (command.action === "recheck")
      return Response.json(await product.recheck(command.id, command.hash));
    return Response.json(
      await product.action(command.id, command.hash, command.action),
    );
  } catch (error) {
    return failure(error);
  }
}
