import { assertAccess, HttpAccessError } from "@/forge/http";
import { getConfig } from "@/forge/config";
import { getService } from "@/forge/server";
import { handleMcpPost } from "@/forge/mcp-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertAccess(request);
    if (getConfig().FORGE_RUNTIME_MODE !== "fixture")
      return Response.json(
        {
          error:
            "The legacy fixture workbench is available only in fixture mode",
        },
        { status: 403 },
      );
    return await handleMcpPost(request, getService(), { fixtures: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Fixture request failed",
      },
      { status: error instanceof HttpAccessError ? error.status : 400 },
    );
  }
}
