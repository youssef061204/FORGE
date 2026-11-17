/**
 * The broker: the only path from a tool to the world. Default deny.
 *
 * A run is allowed only when the tool is active, its approved hash still
 * matches its program, and every input matches a read grant. The program's
 * outputs are proposals: each must match a write grant by exact name and
 * size, or it is refused with a receipt. Duplicate events never write twice.
 */
import { randomUUID } from "node:crypto";
import type { Grant } from "../../core/contracts/passport";
import { sha256Hex } from "../../core/hash";
import { recipeHash } from "../../core/synth/crucible";
import { formatFromName, sniffFormat, type Format } from "../../core/codec";
import type { Bus } from "../bus";
import type { SandboxPool } from "../sandbox/pool";
import type { WorkerOutput, WorkerReply } from "../sandbox/recipe-worker";
import type { ArtifactRow, ReceiptRow, Repo, RunRow } from "../store/repo";

export class Denied extends Error {
  constructor(
    message: string,
    readonly layer: "approval" | "integrity" | "grant" | "size" | "output" | "sandbox" | "revoked",
  ) {
    super(message);
    this.name = "Denied";
  }
}

export type RunInput = { slot: string; fileId?: string; inline?: { name: string; format?: Format; text: string } };
export type RunOutcome = {
  run: RunRow;
  receipts: ReceiptRow[];
  artifacts: ArtifactRow[];
  views: { name: string; view: unknown; rows: Record<string, unknown>[]; columns: string[] }[];
  deduplicated: boolean;
};

export class Broker {
  constructor(
    private readonly repo: Repo,
    private readonly pool: Pick<SandboxPool, "run">,
    private readonly bus?: Bus,
  ) {}

  private deny(toolId: string, version: number, message: string, layer: Denied["layer"], target = "run"): never {
    this.repo.addReceipt({ toolId, version, kind: "deny", target, detail: `${layer}: ${message}`, status: "denied" });
    throw new Denied(message, layer);
  }

  async run(toolId: string, inputs: RunInput[], options: { eventKey?: string; trigger?: string } = {}): Promise<RunOutcome> {
    const tool = this.repo.tool(toolId);
    if (!tool) throw new Denied("There is no tool with that id.", "approval");
    if (tool.status === "revoked") this.deny(toolId, tool.currentVersion ?? 0, `${tool.name} was revoked; it cannot run until a new version is approved.`, "revoked");
    if (tool.status !== "active" || !tool.currentVersion) this.deny(toolId, tool.currentVersion ?? 0, `${tool.name} is not active.`, "approval");
    const version = this.repo.version(toolId, tool.currentVersion)!;
    if (version.status !== "approved") this.deny(toolId, version.version, "This version has no approval.", "approval");

    // Integrity: the program must still be exactly what was approved.
    const actual = recipeHash(version.recipe, version.irHash);
    if (actual !== version.hash) this.deny(toolId, version.version, "The program changed after it was approved. Nothing ran.", "integrity");

    // Inputs: each recipe slot needs a matching read grant.
    const files: { slot: string; name: string; format: Format; text: string; fileId?: string; source: string }[] = [];
    for (const slot of version.recipe.inputs) {
      const given = inputs.find((i) => i.slot === slot.slot) ?? (version.recipe.inputs.length === 1 && inputs.length === 1 ? inputs[0] : undefined);
      if (!given) this.deny(toolId, version.version, `It needs a file for ${slot.slot}.`, "grant", slot.slot);
      const grant = version.grants.find((g): g is Extract<Grant, { kind: "read" }> => g.kind === "read" && g.slot === slot.slot);
      if (!grant) this.deny(toolId, version.version, `It has no permission to read anything as ${slot.slot}.`, "grant", slot.slot);
      let file: { name: string; format: Format; text: string; source: string; fileId?: string };
      if (given.fileId) {
        const row = this.repo.file(given.fileId);
        if (!row) this.deny(toolId, version.version, "That file is not in the workspace.", "grant", slot.slot);
        file = { name: row.name, format: row.format as Format, text: row.text, source: row.source, fileId: row.id };
      } else if (given.inline) {
        file = { name: given.inline.name, format: given.inline.format ?? formatFromName(given.inline.name) ?? sniffFormat(given.inline.text), text: given.inline.text, source: "inline" };
      } else this.deny(toolId, version.version, `No file was given for ${slot.slot}.`, "grant", slot.slot);
      if (grant.scope === "exact-file" && grant.file && file.name !== grant.file)
        this.deny(toolId, version.version, `It may only read ${grant.file}, not ${file.name}.`, "grant", file.name);
      if (grant.scope === "watched-folder" && file.source !== `folder:${grant.folder}`)
        this.deny(toolId, version.version, `It may only read files from ${grant.folder}.`, "grant", file.name);
      const bytes = new TextEncoder().encode(file.text).length;
      if (bytes > version.passport.limits.maxInputBytes)
        this.deny(toolId, version.version, `${file.name} is larger than the ${Math.round(version.passport.limits.maxInputBytes / 1048576)} MB this tool may read.`, "size", file.name);
      files.push({ slot: slot.slot, ...file });
    }

    const eventKey = options.eventKey ?? `manual:${randomUUID()}`;
    const previous = this.repo.previousRun(toolId, version.hash, eventKey);
    if (previous) {
      const receipts = this.repo.receipts(toolId).filter((r) => r.runId === previous.id);
      return { run: previous, receipts: receipts.map((r) => ({ ...r, status: "deduplicated" as const })), artifacts: this.repo.artifacts(previous.id), views: [], deduplicated: true };
    }

    const started = performance.now();
    const runId = `run_${randomUUID().slice(0, 12)}`;
    const reply: WorkerReply = await this.pool.run(
      { recipe: version.recipe, files: files.map(({ slot, name, format, text }) => ({ slot, name, format, text })), now: new Date().toISOString(), instrument: false },
      version.passport.limits.maxMs,
    );
    const ms = performance.now() - started;
    const runInputs = files.map((f) => ({ slot: f.slot, fileId: f.fileId, name: f.name }));
    if (!reply.ok) {
      const run: RunRow = { id: runId, toolId, version: version.version, hash: version.hash, eventKey, trigger: options.trigger ?? "manual", status: "failed", summary: "The run stopped before it finished.", error: reply.error, inputs: runInputs, ms, at: new Date().toISOString() };
      this.repo.addRun(run);
      if (reply.code === "TIMEOUT" || reply.code === "WORKER_CRASH" || reply.code === "WORK_BUDGET")
        this.repo.addReceipt({ runId, toolId, version: version.version, kind: "deny", target: "sandbox", detail: `sandbox: ${reply.error}`, status: "denied" });
      this.bus?.publish({ t: "run.finished", toolId, runId, status: "failed", summary: run.summary });
      return { run, receipts: [], artifacts: [], views: [], deduplicated: false };
    }

    // Every proposed effect is checked against the grants. Default deny.
    const receipts: ReceiptRow[] = [];
    const artifacts: ArtifactRow[] = [];
    const views: RunOutcome["views"] = [];
    const denied: string[] = [];
    for (const out of reply.outputs as WorkerOutput[]) {
      if (out.kind === "view") {
        const grant = version.grants.find((g) => g.kind === "view");
        if (!grant) {
          denied.push(out.name);
          receipts.push(this.repo.addReceipt({ runId, toolId, version: version.version, kind: "deny", target: out.name, detail: "output: no permission to show a view", status: "denied" }));
          continue;
        }
        views.push({ name: out.name, view: out.view, rows: out.preview, columns: out.columns });
        // The latest view is kept so the tool's dashboard can show it.
        const viewKey = sha256Hex(`${toolId}|${version.hash}|${eventKey}|view:${out.name}`);
        if (!this.repo.receiptFor(viewKey)) {
          const artifact = this.repo.addArtifact({ runId, toolId, name: out.name, format: "view", text: JSON.stringify({ view: out.view, columns: out.columns, rows: out.preview }) });
          receipts.push(this.repo.addReceipt({ runId, toolId, version: version.version, kind: "view", target: out.name, detail: `${out.rows} rows on the dashboard`, status: "committed", effectKey: viewKey, artifactId: artifact.id }));
        }
        continue;
      }
      const grant = version.grants.find((g): g is Extract<Grant, { kind: "write" }> => g.kind === "write" && g.output === out.name);
      if (!grant) {
        denied.push(out.name);
        receipts.push(this.repo.addReceipt({ runId, toolId, version: version.version, kind: "deny", target: out.name, detail: "output: it was never granted permission to write this file", status: "denied" }));
        continue;
      }
      if (out.bytes > grant.maxBytes) {
        denied.push(out.name);
        receipts.push(this.repo.addReceipt({ runId, toolId, version: version.version, kind: "deny", target: out.name, detail: `size: ${out.bytes} bytes is over the ${grant.maxBytes}-byte allowance`, status: "denied" }));
        continue;
      }
      const effectKey = sha256Hex(`${toolId}|${version.hash}|${eventKey}|${out.name}`);
      const existing = this.repo.receiptFor(effectKey);
      if (existing) {
        receipts.push({ ...existing, status: "deduplicated" });
        continue;
      }
      const artifact = this.repo.addArtifact({ runId, toolId, name: out.name, format: out.format, text: out.text });
      artifacts.push(artifact);
      receipts.push(this.repo.addReceipt({ runId, toolId, version: version.version, kind: "write", target: out.name, detail: `${out.rows} rows, ${artifact.bytes} bytes`, status: "committed", effectKey, artifactId: artifact.id }));
    }
    const summary = artifacts.length
      ? `Wrote ${artifacts.map((a) => a.name).join(", ")}${denied.length ? `; refused ${denied.join(", ")}` : ""}.`
      : denied.length
        ? `Refused ${denied.join(", ")}.`
        : views.length
          ? "Updated its dashboard."
          : "Finished with nothing to write.";
    const run: RunRow = { id: runId, toolId, version: version.version, hash: version.hash, eventKey, trigger: options.trigger ?? "manual", status: denied.length && !artifacts.length ? "denied" : "done", summary, inputs: runInputs, ms, at: new Date().toISOString() };
    this.repo.addRun(run);
    if (files.some((f) => f.fileId)) this.repo.setLastFiles(toolId, files.filter((f) => f.fileId).map((f) => f.fileId!));
    this.bus?.publish({ t: "run.finished", toolId, runId, status: run.status, summary });
    return { run, receipts, artifacts, views, deduplicated: false };
  }
}
