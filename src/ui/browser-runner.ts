"use client";
import type { PreviewTable, StepPreview } from "@/core/events/types";
import type { Recipe } from "@/core/recipe/schema";
import type { Format } from "@/core/codec";
import type { ViewOutput } from "@/core/recipe/schema";

export type BrowserOutput =
  | { kind: "file"; name: string; format: string; text: string; bytes: number; table: PreviewTable }
  | { kind: "view"; name: string; view: ViewOutput; table: PreviewTable };
export type BrowserRun = {
  ms: number;
  outputs: BrowserOutput[];
  inputs: Record<string, PreviewTable>;
  offsets: Record<string, number>;
  snapshots?: (Omit<StepPreview, "english"> & { table: string; source: string; dropped?: { row: Record<string, unknown>; lineage?: number[] }[] })[];
};

let worker: Worker | undefined;
let seq = 0;
const waiting = new Map<number, { resolve: (r: BrowserRun) => void; reject: (e: Error) => void }>();

export function runInBrowser(recipe: Recipe, files: { slot: string; name: string; format: Format; text: string }[], instrument = true): Promise<BrowserRun> {
  if (!worker) {
    worker = new Worker(new URL("./recipe.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (m) => {
      const w = waiting.get(m.data.id);
      if (!w) return;
      waiting.delete(m.data.id);
      if (m.data.ok) w.resolve(m.data as BrowserRun);
      else w.reject(new Error(m.data.error));
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, recipe, files, instrument, now: new Date().toISOString() });
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error("The tool ran longer than 10 seconds and was stopped."));
    }, 10_000);
  });
}
