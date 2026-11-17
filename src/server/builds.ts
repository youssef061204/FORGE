/**
 * Builds: run the Crucible, append every event to the store, publish it on
 * the bus. Approval is derived from the stored event stream alone and can
 * only come from the FORGE UI's owner-guarded route (no MCP path calls it).
 */
import { randomUUID } from "node:crypto";
import { defaultGrants, grantKey, passportFor, type Grant } from "../core/contracts/passport";
import type { BuildEvent, BuildEventBody, Example } from "../core/events/types";
import { replay } from "../core/events/reducer";
import type { Recipe } from "../core/recipe/schema";
import { recipeHash, runCrucible, type InstalledTool } from "../core/synth/crucible";
import { EXEMPLARS, type Exemplar } from "../core/synth/exemplars";
import { requestKey } from "../core/synth/route";
import type { Format } from "../core/codec";
import type { Bus } from "./bus";
import { modelStatus } from "./models";
import type { Repo } from "./store/repo";
import { lowerAndVerify } from "./verify";

export class BuildError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Pending = { resolve: (answer: { cluster: string } | undefined) => void; timer: ReturnType<typeof setTimeout> };

export class BuildService {
  private pending = new Map<string, Pending>();
  private controllers = new Map<string, AbortController>();
  constructor(
    private readonly repo: Repo,
    private readonly bus: Bus,
  ) {}

  installedTools(): InstalledTool[] {
    return this.repo
      .tools()
      .filter((t) => t.status === "active" && t.currentVersion)
      .map((t) => {
        const v = this.repo.version(t.id, t.currentVersion!)!;
        const files = t.lastFileIds.map((id) => this.repo.file(id)).filter(Boolean);
        return {
          toolId: t.id,
          name: t.name,
          description: t.description,
          requestKey: t.requestKey,
          recipe: v.recipe,
          slots: v.recipe.inputs.map((i) => i.slot),
          columns: {},
          lastFiles: files,
        } as InstalledTool;
      });
  }

  private exemplars(): Exemplar[] {
    if (!this.repo.setting("memory.enabled", true)) return EXEMPLARS;
    const learned: Exemplar[] = this.repo.memory().map((m) => ({
      id: m.id,
      request: m.request,
      recipe: m.recipe,
      files: Object.fromEntries(m.recipe.inputs.map((i, k) => [i.slot, m.files[k] ?? { name: `${i.slot}.csv`, text: "" }])),
      expect: "",
      source: "learned",
    }));
    return [...EXEMPLARS, ...learned];
  }

  async start(args: { request: string; fileIds: string[]; drafts?: number; examples?: Example[]; extendToolId?: string }): Promise<string> {
    const { status, transport } = await modelStatus();
    if (!transport) throw new BuildError(status.state === "offline" ? status.reason : "No model is available.", 503);
    let files = args.fileIds.map((id) => {
      const f = this.repo.file(id);
      if (!f) throw new BuildError(`Unknown file ${id}`);
      return f;
    });
    const tools = this.installedTools();
    const extend = args.extendToolId ? tools.find((t) => t.toolId === args.extendToolId) : undefined;
    if (extend && !files.length) files = this.repo.tool(extend.toolId)!.lastFileIds.map((id) => this.repo.file(id)!).filter(Boolean);
    const id = `b_${randomUUID().slice(0, 10)}`;
    this.repo.createBuild({ id, request: args.request, provenance: transport.provenance, model: transport.model, fileIds: files.map((f) => f.id), parentTool: extend?.toolId });
    this.bus.publish({ t: "build.created", buildId: id, request: args.request });
    let seq = 0;
    const t0 = Date.now();
    const emit = (body: BuildEventBody) => {
      const e = { buildId: id, seq: seq++, atMs: Date.now() - t0, ...body } as BuildEvent;
      this.repo.appendEvent(e);
      this.bus.publishBuild(e);
    };
    const controller = new AbortController();
    this.controllers.set(id, controller);
    void runCrucible(args.request, files.map((f) => ({ name: f.name, format: f.format as Format, text: f.text })), {
      transport,
      emit,
      drafts: args.drafts ?? 5,
      examples: args.examples,
      tools,
      lastToolId: extend?.toolId,
      exemplars: this.exemplars(),
      signal: controller.signal,
      provenance: transport.provenance,
      hardware: process.env.FORGE_HARDWARE,
      lower: (recipe, plan) => lowerAndVerify(recipe, plan).lowered,
      verify: async (recipe, plan, inputs) => lowerAndVerify(recipe, plan, inputs).checks,
      ask: (question) =>
        new Promise((resolve) => {
          this.repo.updateBuild(id, { status: "waiting" });
          const timer = setTimeout(() => {
            this.pending.delete(id);
            resolve(undefined);
          }, 15 * 60_000);
          this.pending.set(id, { resolve, timer });
          void question;
        }),
    })
      .then((result) => {
        this.repo.updateBuild(id, { status: "done", outcome: result.outcome, endedAt: new Date().toISOString() });
        this.bus.publish({ t: "build.ended", buildId: id, outcome: result.outcome });
      })
      .catch((error: unknown) => {
        emit({ t: "build.failed", stage: "internal", reason: error instanceof Error ? error.message : "The build stopped unexpectedly.", suggestions: ["Try again"] });
        emit({ t: "build.ended", outcome: "failed", ms: Date.now() - t0 });
        this.repo.updateBuild(id, { status: "done", outcome: "failed", endedAt: new Date().toISOString() });
      })
      .finally(() => this.controllers.delete(id));
    return id;
  }

  answer(buildId: string, cluster: string) {
    const p = this.pending.get(buildId);
    if (!p) throw new BuildError("This build is not waiting for an answer.", 409);
    clearTimeout(p.timer);
    this.pending.delete(buildId);
    this.repo.updateBuild(buildId, { status: "running" });
    p.resolve({ cluster });
  }

  cancel(buildId: string) {
    this.controllers.get(buildId)?.abort();
  }

  /**
   * Approve exactly what the review showed. The recipe and hash are re-derived
   * from the stored events; any grant not derivable from the recipe is refused.
   */
  approve(buildId: string, args: { hash: string; scopes?: Record<string, Grant> }) {
    const build = this.repo.build(buildId);
    if (!build) throw new BuildError("Unknown build", 404);
    const events = this.repo.events(buildId);
    const view = replay(events, buildId);
    if (!view.review || !view.preview || view.preview.provisional) throw new BuildError("This build has nothing ready to approve.", 409);
    if (view.approved) throw new BuildError("Already approved.", 409);
    if (view.review.hash !== args.hash) throw new BuildError("The approval doesn't match the program on review. Reload and look again.", 409);
    const recipe: Recipe = view.preview.recipe;
    const irHash = view.review.irHash;
    if (recipeHash(recipe, irHash) !== args.hash) throw new BuildError("The program no longer matches its hash.", 409);
    const files = build.fileIds.map((id) => this.repo.file(id)!).filter(Boolean);
    const slotFiles = Object.fromEntries(recipe.inputs.map((i) => [i.slot, files.find((f) => view.inputs.find((x) => x.slot === i.slot)?.name === f.name)?.name]));
    const base = defaultGrants(recipe, slotFiles);
    // The person may narrow a read grant's scope (any file -> this exact file,
    // or a watched folder). Nothing can be widened or added.
    const grants = base.map((g) => {
      if (g.kind !== "read") return g;
      const scoped = args.scopes?.[g.slot];
      if (!scoped) return g;
      if (scoped.kind !== "read" || scoped.slot !== g.slot) throw new BuildError("That permission doesn't belong to this tool.");
      return scoped;
    });
    if (grants.length !== base.length) throw new BuildError("Permissions can only be narrowed, never added.");
    const extendId = build.parentTool;
    const previous = extendId ? this.repo.version(extendId, this.repo.tool(extendId)?.currentVersion ?? 0)?.grants : undefined;
    const passport = passportFor(grants, previous);
    const { tool, version } = this.repo.install({
      toolId: extendId,
      name: view.intent?.title ?? "New tool",
      description: view.intent?.restatement ?? build.request,
      requestKey: requestKey(build.request),
      hash: args.hash,
      irHash,
      recipe,
      english: view.preview.english,
      passport,
      grants,
      examples: view.examples,
      buildId,
      fileIds: build.fileIds,
    });
    this.repo.addReceipt({ toolId: tool.id, version: version.version, kind: "approve", target: tool.name, detail: `approved ${grants.map(grantKey).join(", ")}`, status: "recorded" });
    if (this.repo.setting("memory.enabled", true)) this.repo.remember(build.request, recipe, files.map((f) => ({ name: f.name, text: f.text })));
    let seq = events.at(-1)!.seq + 1;
    const append = (body: BuildEventBody) => {
      const e = { buildId, seq: seq++, atMs: view.elapsedMs, ...body } as BuildEvent;
      this.repo.appendEvent(e);
      this.bus.publishBuild(e);
    };
    append({ t: "approved", hash: args.hash, grants: grants.map(grantKey) });
    append({ t: "installed", toolId: tool.id, version: version.version, name: tool.name });
    this.repo.updateBuild(buildId, { toolId: tool.id, version: version.version, outcome: "installed" });
    this.bus.publish({ t: "tools.changed", reason: "installed", toolId: tool.id });
    return { tool, version };
  }

  revoke(toolId: string) {
    const tool = this.repo.tool(toolId);
    if (!tool) throw new BuildError("Unknown tool", 404);
    this.repo.revoke(toolId);
    this.repo.addReceipt({ toolId, version: tool.currentVersion ?? 0, kind: "revoke", target: tool.name, detail: "revoked by the owner; all grants removed", status: "recorded" });
    this.bus.publish({ t: "tools.changed", reason: "revoked", toolId });
  }
}
