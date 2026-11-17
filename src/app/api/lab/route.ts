import { getService } from "@/forge/server";
import { assertAccess, readJson, HttpAccessError } from "@/forge/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertAccess(request);
    return Response.json(await getService().lab.snapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    assertAccess(request);
    return Response.json(
      await getService().lab.command(await readJson(request)),
    );
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Lab operation failed" },
    { status: error instanceof HttpAccessError ? error.status : 400 },
  );
}
