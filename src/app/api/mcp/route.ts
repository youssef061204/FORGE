import { assertAccess, HttpAccessError } from "@/forge/http";
import { getService } from "@/forge/server";
import { handleMcpPost } from "@/forge/mcp-http";
import { getProduct } from "@/forge/product/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertAccess(request);
    await getProduct();
    return await handleMcpPost(request, getService());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "MCP request failed" },
      { status: e instanceof HttpAccessError ? e.status : 400 },
    );
  }
}
export function GET(request: Request) {
  try {
    assertAccess(request);
    return new Response("Stateless MCP endpoint: use POST.", {
      status: 405,
      headers: { Allow: "POST" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "MCP request failed" },
      { status: error instanceof HttpAccessError ? error.status : 400 },
    );
  }
}
