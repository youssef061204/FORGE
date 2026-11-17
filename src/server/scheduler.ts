/**
 * Schedules: manual, every N minutes, or when a file changes in a watched
 * folder. Folder runs read the new file through the broker like any run; the
 * event key is the file's content hash, so the same export never runs twice.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatFromName } from "../core/codec";
import { sha256Hex } from "../core/hash";
import type { Forge } from "./forge";

const EXT = /\.(csv|tsv|json|jsonl|txt|log)$/i;

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private seen = new Map<string, number>();
  private running = false;
  constructor(private readonly forge: Forge) {}

  start(everyMs = 5000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      const { repo, broker } = this.forge;
      for (const tool of repo.tools()) {
        if (tool.status !== "active" || !tool.schedule || tool.schedule.kind === "manual") continue;
        const v = repo.version(tool.id, tool.currentVersion!);
        if (!v || v.recipe.inputs.length !== 1) continue;
        const slot = v.recipe.inputs[0].slot;
        if (tool.schedule.kind === "interval") {
          const period = Math.max(1, tool.schedule.minutes) * 60_000;
          const bucket = Math.floor(now / period);
          const last = repo.runs(tool.id, 1)[0];
          if (last && Date.now() - Date.parse(last.at) < period) continue;
          const fileId = tool.lastFileIds[0];
          if (!fileId) continue;
          await broker.run(tool.id, [{ slot, fileId }], { eventKey: `interval:${bucket}`, trigger: "schedule" }).catch(() => undefined);
        } else {
          const folder = resolve(tool.schedule.folder);
          let names: string[];
          try {
            names = readdirSync(folder).filter((n) => EXT.test(n));
          } catch {
            continue;
          }
          for (const name of names) {
            const path = join(folder, name);
            const mtime = statSync(path).mtimeMs;
            const key = `${tool.id}|${path}`;
            if (this.seen.get(key) === mtime) continue;
            this.seen.set(key, mtime);
            const text = readFileSync(path, "utf8");
            if (text.length > 10 * 1024 * 1024) continue;
            const file = repo.addFile(name, formatFromName(name) ?? "csv", text, `folder:${tool.schedule.folder}`);
            await broker.run(tool.id, [{ slot, fileId: file.id }], { eventKey: `folder:${sha256Hex(text)}`, trigger: "folder" }).catch(() => undefined);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
