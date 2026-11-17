/** Typed repositories over the SQLite store. All JSON columns are parsed here. */
import { randomUUID } from "node:crypto";
import type { DatabaseSync as DB } from "node:sqlite";
import type { Grant, Passport } from "../../core/contracts/passport";
import type { BuildEvent, Example } from "../../core/events/types";
import { sha256Hex } from "../../core/hash";
import type { Recipe } from "../../core/recipe/schema";
import { tx } from "./db";

const now = () => new Date().toISOString();
const j = <T>(text: string | null | undefined, fallback: T): T => (text ? (JSON.parse(text) as T) : fallback);

export type FileRow = { id: string; name: string; format: string; bytes: number; sha256: string; text: string; source: string; createdAt: string };
export type BuildRow = {
  id: string;
  request: string;
  status: "running" | "waiting" | "done";
  outcome?: string;
  provenance: string;
  model?: string;
  fileIds: string[];
  parentTool?: string;
  toolId?: string;
  version?: number;
  createdAt: string;
  endedAt?: string;
};
export type ToolRow = {
  id: string;
  name: string;
  description: string;
  requestKey: string;
  status: "active" | "paused" | "revoked";
  currentVersion?: number;
  lastFileIds: string[];
  schedule?: { kind: "manual" } | { kind: "interval"; minutes: number } | { kind: "folder"; folder: string };
  createdAt: string;
  updatedAt: string;
};
export type VersionRow = {
  toolId: string;
  version: number;
  hash: string;
  irHash?: string;
  recipe: Recipe;
  english: string[];
  passport: Passport;
  grants: Grant[];
  examples: Example[];
  buildId?: string;
  status: "approved" | "superseded" | "revoked";
  approvedAt?: string;
  createdAt: string;
};
export type RunRow = {
  id: string;
  toolId: string;
  version: number;
  hash: string;
  eventKey: string;
  trigger: string;
  status: "done" | "failed" | "denied";
  summary: string;
  error?: string;
  inputs: { slot: string; fileId?: string; name: string }[];
  ms: number;
  at: string;
};
export type ReceiptRow = {
  id: string;
  runId?: string;
  toolId: string;
  version: number;
  kind: "write" | "view" | "approve" | "revoke" | "deny" | "install";
  target: string;
  detail: string;
  status: "committed" | "deduplicated" | "denied" | "recorded";
  effectKey?: string;
  artifactId?: string;
  at: string;
};
export type ArtifactRow = { id: string; runId: string; toolId: string; name: string; format: string; bytes: number; sha256: string; text: string; createdAt: string };

export class Repo {
  constructor(readonly db: DB) {}

  // files ------------------------------------------------------------------
  addFile(name: string, format: string, text: string, source = "upload"): FileRow {
    const sha = sha256Hex(text);
    const existing = this.db.prepare("SELECT * FROM files WHERE sha256 = ? AND name = ?").get(sha, name) as Record<string, string> | undefined;
    if (existing) return this.fileFrom(existing);
    const row: FileRow = { id: `f_${randomUUID().slice(0, 12)}`, name, format, bytes: new TextEncoder().encode(text).length, sha256: sha, text, source, createdAt: now() };
    this.db.prepare("INSERT INTO files (id, name, format, bytes, sha256, text, source, created_at) VALUES (?,?,?,?,?,?,?,?)").run(row.id, row.name, row.format, row.bytes, row.sha256, row.text, row.source, row.createdAt);
    return row;
  }
  file(id: string): FileRow | undefined {
    const r = this.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as Record<string, string> | undefined;
    return r ? this.fileFrom(r) : undefined;
  }
  files(limit = 50): Omit<FileRow, "text">[] {
    return (this.db.prepare("SELECT id, name, format, bytes, sha256, source, created_at FROM files ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, string>[]).map((r) => ({ ...this.fileFrom({ ...r, text: "" }), text: undefined }) as never);
  }
  private fileFrom(r: Record<string, string>): FileRow {
    return { id: r.id, name: r.name, format: r.format, bytes: Number(r.bytes), sha256: r.sha256, text: r.text, source: r.source, createdAt: r.created_at };
  }

  // builds and their events --------------------------------------------------
  createBuild(b: Omit<BuildRow, "createdAt" | "status">): BuildRow {
    const row: BuildRow = { ...b, status: "running", createdAt: now() };
    this.db
      .prepare("INSERT INTO builds (id, request, status, outcome, provenance, model, file_ids, parent_tool, tool_id, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.request, row.status, null, row.provenance, row.model ?? null, JSON.stringify(row.fileIds), row.parentTool ?? null, null, null, row.createdAt);
    return row;
  }
  updateBuild(id: string, patch: Partial<Pick<BuildRow, "status" | "outcome" | "toolId" | "version" | "endedAt">>) {
    const cur = this.build(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db.prepare("UPDATE builds SET status = ?, outcome = ?, tool_id = ?, version = ?, ended_at = ? WHERE id = ?").run(next.status, next.outcome ?? null, next.toolId ?? null, next.version ?? null, next.endedAt ?? null, id);
  }
  build(id: string): BuildRow | undefined {
    const r = this.db.prepare("SELECT * FROM builds WHERE id = ?").get(id) as Record<string, string> | undefined;
    return r ? this.buildFrom(r) : undefined;
  }
  builds(limit = 30): BuildRow[] {
    return (this.db.prepare("SELECT * FROM builds ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, string>[]).map((r) => this.buildFrom(r));
  }
  private buildFrom(r: Record<string, string>): BuildRow {
    return {
      id: r.id,
      request: r.request,
      status: r.status as BuildRow["status"],
      outcome: r.outcome ?? undefined,
      provenance: r.provenance,
      model: r.model ?? undefined,
      fileIds: j(r.file_ids, []),
      parentTool: r.parent_tool ?? undefined,
      toolId: r.tool_id ?? undefined,
      version: r.version === null || r.version === undefined ? undefined : Number(r.version),
      createdAt: r.created_at,
      endedAt: r.ended_at ?? undefined,
    };
  }
  appendEvent(e: BuildEvent) {
    const { buildId, seq, atMs, t } = e;
    this.db.prepare("INSERT INTO events (build_id, seq, at_ms, type, body) VALUES (?,?,?,?,?)").run(buildId, seq, atMs, t, JSON.stringify(e));
  }
  events(buildId: string, afterSeq = -1): BuildEvent[] {
    return (this.db.prepare("SELECT body FROM events WHERE build_id = ? AND seq > ? ORDER BY seq").all(buildId, afterSeq) as { body: string }[]).map((r) => JSON.parse(r.body) as BuildEvent);
  }

  // tools and versions -------------------------------------------------------
  tool(id: string): ToolRow | undefined {
    const r = this.db.prepare("SELECT * FROM tools WHERE id = ?").get(id) as Record<string, string> | undefined;
    return r ? this.toolFrom(r) : undefined;
  }
  tools(): ToolRow[] {
    return (this.db.prepare("SELECT * FROM tools ORDER BY updated_at DESC").all() as Record<string, string>[]).map((r) => this.toolFrom(r));
  }
  private toolFrom(r: Record<string, string>): ToolRow {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      requestKey: r.request_key,
      status: r.status as ToolRow["status"],
      currentVersion: r.current_version === null ? undefined : Number(r.current_version),
      lastFileIds: j(r.last_file_ids, []),
      schedule: j(r.schedule, undefined),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  version(toolId: string, version: number): VersionRow | undefined {
    const r = this.db.prepare("SELECT * FROM versions WHERE tool_id = ? AND version = ?").get(toolId, version) as Record<string, string> | undefined;
    return r ? this.versionFrom(r) : undefined;
  }
  versions(toolId: string): VersionRow[] {
    return (this.db.prepare("SELECT * FROM versions WHERE tool_id = ? ORDER BY version DESC").all(toolId) as Record<string, string>[]).map((r) => this.versionFrom(r));
  }
  private versionFrom(r: Record<string, string>): VersionRow {
    return {
      toolId: r.tool_id,
      version: Number(r.version),
      hash: r.hash,
      irHash: r.ir_hash ?? undefined,
      recipe: j(r.recipe, {} as Recipe),
      english: j(r.english, []),
      passport: j(r.passport, {} as Passport),
      grants: j(r.grants, []),
      examples: j(r.examples, []),
      buildId: r.build_id ?? undefined,
      status: r.status as VersionRow["status"],
      approvedAt: r.approved_at ?? undefined,
      createdAt: r.created_at,
    };
  }

  /** Install an approved version. The previous version keeps nothing: grants never carry over. */
  install(args: {
    toolId?: string;
    name: string;
    description: string;
    requestKey: string;
    hash: string;
    irHash?: string;
    recipe: Recipe;
    english: string[];
    passport: Passport;
    grants: Grant[];
    examples: Example[];
    buildId: string;
    fileIds: string[];
  }): { tool: ToolRow; version: VersionRow } {
    return tx(this.db, () => {
      const at = now();
      let tool = args.toolId ? this.tool(args.toolId) : undefined;
      if (!tool) {
        const id = `t_${randomUUID().slice(0, 10)}`;
        this.db
          .prepare("INSERT INTO tools (id, name, description, request_key, status, current_version, last_file_ids, schedule, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(id, args.name, args.description, args.requestKey, "active", null, JSON.stringify(args.fileIds), null, at, at);
        tool = this.tool(id)!;
      }
      const next = (this.versions(tool.id)[0]?.version ?? 0) + 1;
      this.db.prepare("UPDATE versions SET status = 'superseded', grants = '[]' WHERE tool_id = ? AND status = 'approved'").run(tool.id);
      this.db
        .prepare("INSERT INTO versions (tool_id, version, hash, ir_hash, recipe, english, passport, grants, examples, build_id, status, approved_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(tool.id, next, args.hash, args.irHash ?? null, JSON.stringify(args.recipe), JSON.stringify(args.english), JSON.stringify(args.passport), JSON.stringify(args.grants), JSON.stringify(args.examples), args.buildId, "approved", at, at);
      this.db.prepare("UPDATE tools SET status = 'active', current_version = ?, name = ?, description = ?, last_file_ids = ?, updated_at = ? WHERE id = ?").run(next, args.name, args.description, JSON.stringify(args.fileIds), at, tool.id);
      for (const ex of args.examples) this.db.prepare("INSERT OR REPLACE INTO examples (id, tool_id, body, created_at) VALUES (?,?,?,?)").run(`${tool.id}:${ex.id}`, tool.id, JSON.stringify(ex), at);
      return { tool: this.tool(tool.id)!, version: this.version(tool.id, next)! };
    });
  }

  revoke(toolId: string) {
    tx(this.db, () => {
      const at = now();
      this.db.prepare("UPDATE tools SET status = 'revoked', updated_at = ? WHERE id = ?").run(at, toolId);
      this.db.prepare("UPDATE versions SET status = 'revoked', grants = '[]' WHERE tool_id = ? AND status = 'approved'").run(toolId);
    });
  }
  setSchedule(toolId: string, schedule: ToolRow["schedule"]) {
    this.db.prepare("UPDATE tools SET schedule = ?, updated_at = ? WHERE id = ?").run(schedule ? JSON.stringify(schedule) : null, now(), toolId);
  }
  setLastFiles(toolId: string, fileIds: string[]) {
    this.db.prepare("UPDATE tools SET last_file_ids = ? WHERE id = ?").run(JSON.stringify(fileIds), toolId);
  }

  // runs, receipts, artifacts --------------------------------------------------
  previousRun(toolId: string, hash: string, eventKey: string): RunRow | undefined {
    const r = this.db.prepare("SELECT * FROM runs WHERE tool_id = ? AND hash = ? AND event_key = ? AND status = 'done'").get(toolId, hash, eventKey) as Record<string, string> | undefined;
    return r ? this.runFrom(r) : undefined;
  }
  addRun(run: RunRow) {
    this.db
      .prepare("INSERT INTO runs (id, tool_id, version, hash, event_key, trigger, status, summary, error, inputs, ms, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(run.id, run.toolId, run.version, run.hash, run.eventKey, run.trigger, run.status, run.summary, run.error ?? null, JSON.stringify(run.inputs), run.ms, run.at);
  }
  runs(toolId?: string, limit = 50): RunRow[] {
    const rows = toolId
      ? this.db.prepare("SELECT * FROM runs WHERE tool_id = ? ORDER BY at DESC LIMIT ?").all(toolId, limit)
      : this.db.prepare("SELECT * FROM runs ORDER BY at DESC LIMIT ?").all(limit);
    return (rows as Record<string, string>[]).map((r) => this.runFrom(r));
  }
  private runFrom(r: Record<string, string>): RunRow {
    return {
      id: r.id,
      toolId: r.tool_id,
      version: Number(r.version),
      hash: r.hash,
      eventKey: r.event_key,
      trigger: r.trigger,
      status: r.status as RunRow["status"],
      summary: r.summary,
      error: r.error ?? undefined,
      inputs: j(r.inputs, []),
      ms: Number(r.ms),
      at: r.at,
    };
  }
  receiptFor(effectKey: string): ReceiptRow | undefined {
    const r = this.db.prepare("SELECT * FROM receipts WHERE effect_key = ? AND status = 'committed'").get(effectKey) as Record<string, string> | undefined;
    return r ? this.receiptFrom(r) : undefined;
  }
  addReceipt(receipt: Omit<ReceiptRow, "id" | "at">): ReceiptRow {
    const row: ReceiptRow = { ...receipt, id: `r_${randomUUID().slice(0, 12)}`, at: now() };
    this.db
      .prepare("INSERT INTO receipts (id, run_id, tool_id, version, kind, target, detail, status, effect_key, artifact_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.runId ?? null, row.toolId, row.version, row.kind, row.target, row.detail, row.status, row.effectKey ?? null, row.artifactId ?? null, row.at);
    return row;
  }
  receipts(toolId?: string, limit = 100): ReceiptRow[] {
    const rows = toolId
      ? this.db.prepare("SELECT * FROM receipts WHERE tool_id = ? ORDER BY at DESC LIMIT ?").all(toolId, limit)
      : this.db.prepare("SELECT * FROM receipts ORDER BY at DESC LIMIT ?").all(limit);
    return (rows as Record<string, string>[]).map((r) => this.receiptFrom(r));
  }
  private receiptFrom(r: Record<string, string>): ReceiptRow {
    return {
      id: r.id,
      runId: r.run_id ?? undefined,
      toolId: r.tool_id,
      version: Number(r.version),
      kind: r.kind as ReceiptRow["kind"],
      target: r.target,
      detail: r.detail,
      status: r.status as ReceiptRow["status"],
      effectKey: r.effect_key ?? undefined,
      artifactId: r.artifact_id ?? undefined,
      at: r.at,
    };
  }
  addArtifact(a: Omit<ArtifactRow, "id" | "createdAt" | "sha256" | "bytes">): ArtifactRow {
    const row: ArtifactRow = { ...a, id: `a_${randomUUID().slice(0, 12)}`, sha256: sha256Hex(a.text), bytes: new TextEncoder().encode(a.text).length, createdAt: now() };
    this.db
      .prepare("INSERT INTO artifacts (id, run_id, tool_id, name, format, bytes, sha256, text, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.runId, row.toolId, row.name, row.format, row.bytes, row.sha256, row.text, row.createdAt);
    return row;
  }
  artifact(id: string): ArtifactRow | undefined {
    const r = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Record<string, string> | undefined;
    return r
      ? { id: r.id, runId: r.run_id, toolId: r.tool_id, name: r.name, format: r.format, bytes: Number(r.bytes), sha256: r.sha256, text: r.text, createdAt: r.created_at }
      : undefined;
  }
  artifacts(runId: string): ArtifactRow[] {
    return (this.db.prepare("SELECT * FROM artifacts WHERE run_id = ?").all(runId) as Record<string, string>[]).map((r) => this.artifact(r.id)!);
  }

  // learned memory -------------------------------------------------------------
  remember(request: string, recipe: Recipe, files: { name: string; text: string }[]) {
    this.db.prepare("INSERT INTO memory (id, request, recipe, files, created_at) VALUES (?,?,?,?,?)").run(`m_${randomUUID().slice(0, 10)}`, request, JSON.stringify(recipe), JSON.stringify(files.map((f) => ({ name: f.name, text: f.text.slice(0, 4000) }))), now());
  }
  memory(): { id: string; request: string; recipe: Recipe; files: { name: string; text: string }[] }[] {
    return (this.db.prepare("SELECT * FROM memory ORDER BY created_at DESC LIMIT 200").all() as Record<string, string>[]).map((r) => ({ id: r.id, request: r.request, recipe: j(r.recipe, {} as Recipe), files: j(r.files, []) }));
  }

  setting<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }
}
