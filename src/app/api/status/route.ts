import { forge, isShowcase } from "@/server/forge";
import { handle, json } from "@/server/http";
import { egressStats } from "@/server/egress";
import { modelStatus } from "@/server/models";

export async function GET(req: Request) {
  return handle(req, async () => {
    const { status } = await modelStatus(new URL(req.url).searchParams.has("refresh"));
    const f = forge();
    return json({
      mode: isShowcase() ? "showcase" : "local",
      model: status,
      egress: egressStats(),
      tools: f.repo.tools().filter((t) => t.status === "active").length,
    });
  });
}
