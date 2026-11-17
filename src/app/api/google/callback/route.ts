import { getService } from "@/forge/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookie =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("forge_oauth_state="))
      ?.slice("forge_oauth_state=".length) ?? "";
  try {
    if (url.searchParams.has("error"))
      throw new Error("Google consent was declined");
    const host = request.headers.get("host") ?? url.host;
    if (!/^[a-zA-Z0-9.\-:\[\]]+$/.test(host))
      throw new Error("Invalid OAuth callback host");
    const service = getService();
    await service.google.complete(
      url.searchParams.get("code") ?? "",
      url.searchParams.get("state") ?? "",
      cookie,
      url.protocol + "//" + host + url.pathname,
    );
    const snapshot = await service.store.read();
    for (const release of snapshot.releases)
      if (snapshot.live?.trust[release.digest]?.connector === "google")
        await service.revoke(release.definition.id);
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/live?google=connected",
        "Set-Cookie":
          "forge_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=0",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/live?google=consent-failed",
        "Set-Cookie":
          "forge_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=0",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
}
