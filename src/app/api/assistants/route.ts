import { forge, mcpHub } from "@/server/forge";
import { handle, json } from "@/server/http";
import { simulate, simulation } from "@/server/mcp/simulate";

export async function GET(req: Request) {
  return handle(req, () => json({ sessions: mcpHub().list(), simulation: simulation(), cwd: process.cwd() }));
}

/** Start the simulated assistant. */
export async function POST(req: Request) {
  return handle(
    req,
    () => {
      const base = `http://${req.headers.get("host") ?? "127.0.0.1:3110"}`;
      mcpHub();
      void simulate(base, forge().bus);
      return json({ ok: true });
    },
    { mutate: true },
  );
}
