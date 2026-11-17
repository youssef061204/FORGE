import { forge } from "@/server/forge";
import { handle, json } from "@/server/http";

export async function GET(req: Request) {
  return handle(req, () => {
    const { repo } = forge();
    return json({
      tools: repo.tools().map((t) => {
        const v = t.currentVersion ? repo.version(t.id, t.currentVersion) : undefined;
        return {
          ...t,
          version: v ? { version: v.version, hash: v.hash, english: v.english, passport: v.passport, recipe: v.recipe, grants: v.grants } : undefined,
          lastRun: repo.runs(t.id, 1)[0],
        };
      }),
    });
  });
}
