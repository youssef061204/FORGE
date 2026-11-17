import {
  randomInt,
  randomUUID,
  sign,
  verify,
  createPublicKey,
} from "node:crypto";
import { z } from "zod";
import type { ForgeService } from "./service";
import type { Sandbox } from "./sandbox";
import { digest } from "./hash";
import { signingKey } from "./capsule";
import { cityActionNames } from "./city-contracts";
import { controlCity, cityEvent } from "./city-engine";
import { pairedSeeds, rollout } from "./futures";
import { failureInterval } from "./evidence-statistics";
import { labCommandSchema, type LabReport } from "./lab-contracts";
import type { State } from "./records";
const payloadSchema = z
  .object({
    version: z.literal("forge-evidence/v1"),
    at: z.string(),
    contestId: z.string(),
    snapshotHash: z.string(),
    goalHash: z.string(),
    sourceHash: z.string(),
    releaseDigest: z.string(),
    seedsHash: z.string(),
    resultsHash: z.string(),
    samples: z.number().int().min(20).max(40),
    failures: z.number().int().min(0).max(40),
    provider: z.string(),
    requestIds: z.array(z.string()),
    scope: z.literal("DIGITAL TWIN"),
  })
  .strict();
export const passportSchema = z
  .object({
    payload: payloadSchema,
    hash: z.string().length(64),
    publicKey: z.string().max(500),
    signature: z.string().max(200),
    issuer: z.literal("LOCAL ED25519; not AWS KMS"),
  })
  .strict();
export function verifyPassport(value: unknown) {
  const passport = passportSchema.parse(value);
  const key = createPublicKey(passport.publicKey);
  if (
    passport.hash !== digest(passport.payload) ||
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(passport.hash),
      key,
      Buffer.from(passport.signature, "base64"),
    )
  )
    throw new Error("Evidence passport signature or content invalid");
  return {
    integrity: "VALID",
    fingerprint: digest(passport.publicKey),
    issuerAuthenticated: false,
    limitation:
      "Verify issuer fingerprint separately; a self-signed receipt proves integrity, not independent certification.",
  };
}
function initialize(state: State) {
  return (state.lab ??= { missions: [], checkpoints: [], reports: [] });
}
export class CityLab {
  private experimenting = false;
  constructor(
    private service: ForgeService,
    private sandbox: Sandbox,
    private now = () => Date.now(),
  ) {}
  async snapshot() {
    const state = await this.service.store.read();
    return {
      missions: state.lab?.missions ?? [],
      checkpoints: (state.lab?.checkpoints ?? []).map(
        ({ id, name, at, hash, snapshot }) => ({
          id,
          name,
          at,
          hash,
          revision: snapshot.revision,
        }),
      ),
      reports: state.lab?.reports ?? [],
      uncertainty: (state.contests?.at(-1)?.candidates ?? [])
        .filter((c) => c.rollouts.length)
        .map((c) => ({
          id: c.id,
          name: c.name,
          interval: failureInterval(
            c.rollouts.filter((r) => r.error || r.violations.length).length,
            c.rollouts.length,
          ),
        })),
    };
  }
  async mission(request: string, followUp = false) {
    if (request.length < 5 || request.length > 3000)
      throw new Error("Mission must contain 5 to 3000 characters");
    const state = await this.service.store.read();
    const last = state.lab?.missions.at(-1);
    const parent = state.city?.deployment?.id;
    const prior = last && state.contests?.find((c) => c.id === last.contestId);
    const context =
      followUp && last
        ? "\nOwner conversation context (retain constraints unless owner explicitly changes them):\n" +
          JSON.stringify({
            previousRequest: last.request.slice(0, 200),
            constraints: prior?.goal?.hard,
            objectives: prior?.goal?.objectives,
            actions: prior?.goal?.actions,
          })
        : "";
    if ((request + context).length > 4000)
      throw new Error(
        "Follow-up and retained constraints exceed the compilation budget. Shorten the new request.",
      );
    const job = await this.service.city.request(
      request + context,
      followUp ? parent : undefined,
    );
    await this.service.store.transaction((s) => {
      const lab = initialize(s);
      lab.missions = [
        ...lab.missions.slice(-11),
        {
          at: new Date().toISOString(),
          request,
          followUp,
          contestId: job.contestId,
        },
      ];
    });
    return {
      ...job,
      contextUsed: !!context,
      previousVersion: followUp ? (parent ?? null) : null,
    };
  }
  async command(input: unknown) {
    const command = labCommandSchema.parse(input);
    if (command.action === "briefing") return this.briefing();
    if (command.action === "passport") return this.passport(command.contestId);
    if (command.action === "experiment") return this.experiment(command);
    if (command.action === "checkpoint") {
      const city = await this.service.city.provider.observe();
      delete city.deployment;
      const checkpoint = {
        id: randomUUID(),
        name: command.name,
        at: new Date().toISOString(),
        hash: digest(city),
        snapshot: city,
      };
      await this.service.store.transaction((s) => {
        const lab = initialize(s);
        lab.checkpoints = [...lab.checkpoints.slice(-2), checkpoint];
      });
      return {
        id: checkpoint.id,
        name: checkpoint.name,
        hash: checkpoint.hash,
        authorityIncluded: false,
      };
    }
    if (command.action === "restore") {
      return this.service.store.transaction((s) => {
        const checkpoint = initialize(s).checkpoints.find(
          (c) => c.id === command.id,
        );
        if (!checkpoint || digest(checkpoint.snapshot) !== checkpoint.hash)
          throw new Error("Intact checkpoint required");
        if (s.city?.id !== checkpoint.snapshot.id)
          throw new Error("Checkpoint binding changed");
        for (const release of s.releases.filter(
          (r) => r.definition.executable?.interface === "city/v1",
        )) {
          const trust = s.live?.trust[release.digest];
          if (trust) {
            trust.current = "REVOKED";
            trust.grants = [];
            trust.stages.push({
              stage: "CHECKPOINT_RESTORE_REVOKED",
              at: new Date().toISOString(),
            });
          }
        }
        const revision = s.city.revision + 1;
        s.city = structuredClone(checkpoint.snapshot);
        delete s.city.deployment;
        s.city.paused = true;
        s.city.revision = revision;
        delete s.lab!.challenge;
        cityEvent(
          s.city,
          "Owner restored checkpoint " +
            checkpoint.name +
            "; City authority revoked, simulation paused",
          "human",
        );
        s.audit.push({
          at: new Date().toISOString(),
          action: "city.checkpoint.restore",
          capabilityId: "city",
          details: checkpoint.hash,
        });
        return {
          restored: checkpoint.id,
          authorityRevoked: true,
          paused: true,
          externalServicesRewound: false,
        };
      });
    }
    if (command.action === "arm") {
      const code = randomInt(100000, 1000000).toString();
      const expiresAt = this.now() + 60000;
      await this.service.city.provider.observe();
      await this.service.store.transaction((s) => {
        const contest = s.contests?.find((c) => c.id === command.contestId);
        const release = s.releases.find(
          (r) =>
            r.digest === command.digest &&
            r.futures?.contestId === command.contestId,
        );
        if (
          !contest ||
          contest.status !== "review" ||
          contest.releaseDigest !== command.digest ||
          !release?.report.passed ||
          !release.futures?.passed
        )
          throw new Error("Exact passing proposal required to arm approval");
        initialize(s).challenge = {
          contestId: command.contestId,
          digest: command.digest,
          binding: s.city!.id,
          codeHash: digest({
            code,
            digest: command.digest,
            contestId: command.contestId,
          }),
          expiresAt,
        };
      });
      return {
        code,
        expiresAt,
        digest: command.digest,
        instruction:
          "Say confirm followed by the six digits; this is owner confirmation, not voice identity verification.",
      };
    }
    const challenge = await this.service.store.transaction((s) => {
      const challenge = initialize(s).challenge;
      delete s.lab!.challenge; // Every attempt consumes the nonce, including failed guesses.
      if (
        !challenge ||
        challenge.expiresAt <= this.now() ||
        challenge.binding !== s.city?.id ||
        challenge.codeHash !==
          digest({
            code: command.code,
            digest: challenge.digest,
            contestId: challenge.contestId,
          })
      )
        return undefined;
      return challenge;
    });
    if (!challenge)
      throw new Error(
        "Approval challenge invalid, expired or already consumed",
      );
    return this.service.city.approve(challenge.contestId, challenge.digest);
  }
  async briefing() {
    const city = await this.service.city.provider.observe(),
      state = await this.service.store.read(),
      contest = state.contests?.at(-1);
    const winner = contest?.candidates.find((c) => c.id === contest.winner);
    const uncertainty = winner?.rollouts.length
      ? failureInterval(
          winner.rollouts.filter((r) => r.error || r.violations.length).length,
          winner.rollouts.length,
        )
      : undefined;
    return {
      text:
        "Digital twin briefing. Hospital power is " +
        Math.round(city.metrics.hospitalPower * 100) +
        " percent. Congestion is " +
        Math.round(city.metrics.congestion * 100) +
        " percent. " +
        city.metrics.exposedPeople +
        " people are exposed. " +
        (city.deployment
          ? "Policy version " +
            city.deployment.version +
            " is bound to the City."
          : "No City policy has authority.") +
        (uncertainty
          ? " The winning policy had " +
            uncertainty.failures +
            " failures in " +
            uncertainty.samples +
            " sampled futures. The 95 percent Wilson upper bound is " +
            Math.round(uncertainty.upper * 100) +
            " percent, under the sampling assumption. This is not a safety guarantee."
          : ""),
      generatedAt: new Date().toISOString(),
      provider: "Measured City state; browser speech synthesis when enabled",
      uncertainty,
    };
  }
  async passport(contestId: string) {
    const state = await this.service.store.read(),
      contest = state.contests?.find((c) => c.id === contestId);
    const candidate = contest?.candidates.find((c) => c.id === contest.winner);
    const release = state.releases.find(
      (r) => r.digest === contest?.releaseDigest,
    );
    if (
      !contest?.goal ||
      !candidate ||
      candidate.rollouts.length < 20 ||
      candidate.rollouts.length > 40 ||
      !release?.futures?.passed ||
      digest(release.definition) !== release.digest ||
      digest(candidate.source) !== candidate.hash ||
      digest(release.definition.goal) !== digest(contest.goal) ||
      release.futures.sourceHash !== candidate.hash ||
      release.futures.snapshotHash !== contest.snapshotHash ||
      candidate.rollouts.some((r) => r.error || r.violations.length) ||
      digest(candidate.rollouts.map((r) => r.seed)) !==
        digest(contest.seeds.slice(0, candidate.rollouts.length)) ||
      release.definition.executable?.source !== candidate.source
    )
      throw new Error("Intact evaluated release required");
    const payload = payloadSchema.parse({
      version: "forge-evidence/v1",
      at: new Date().toISOString(),
      contestId,
      snapshotHash: contest.snapshotHash,
      goalHash: digest(contest.goal),
      sourceHash: candidate.hash,
      releaseDigest: release.digest,
      seedsHash: digest(contest.seeds),
      resultsHash: digest(candidate.rollouts),
      samples: candidate.rollouts.length,
      failures: candidate.rollouts.filter((r) => r.error || r.violations.length)
        .length,
      provider: candidate.provider,
      requestIds: candidate.requestIds,
      scope: "DIGITAL TWIN",
    });
    const key = await signingKey(this.service.google.vault),
      hash = digest(payload);
    const passport = {
      payload,
      hash,
      publicKey: key.publicKey,
      signature: sign(null, Buffer.from(hash), key.privateKey).toString(
        "base64",
      ),
      issuer: "LOCAL ED25519; not AWS KMS" as const,
    };
    return { passport, verification: verifyPassport(passport) };
  }
  async experiment(
    command: Extract<
      z.infer<typeof labCommandSchema>,
      { action: "experiment" }
    >,
  ) {
    if (this.experimenting)
      throw new Error("A counterfactual experiment is already running");
    this.experimenting = true;
    try {
      const state = await this.service.store.read();
      const release = state.releases.find((r) => r.digest === command.digest);
      if (
        !release?.definition.goal ||
        release.definition.executable?.interface !== "city/v1" ||
        !release.report.passed ||
        digest(release.definition) !== command.digest
      )
        throw new Error("Intact tested City artifact required");
      if (command.kind === "what-if" && !command.change)
        throw new Error("What-if requires a typed simulation change");
      if (
        command.kind === "ablation" &&
        (!command.operation ||
          !(cityActionNames as readonly string[]).includes(command.operation))
      )
        throw new Error("Ablation requires a supported action operation");
      const snapshot = await this.service.city.provider.observe(),
        cap = release.definition;
      const report: LabReport = {
        id: randomUUID(),
        kind: command.kind,
        at: new Date().toISOString(),
        status: "running",
        sourceDigest: release.digest,
        snapshotHash: digest(snapshot),
        currentWorldChanged: false,
        rows: [],
      };
      await this.service.store.transaction((s) => {
        const lab = initialize(s);
        lab.reports = [...lab.reports.slice(-4), report];
      });
      const persist = async () =>
        this.service.store.transaction((s) => {
          const index =
            s.lab?.reports.findIndex((r) => r.id === report.id) ?? -1;
          if (index < 0) throw new Error("Experiment evidence removed");
          s.lab!.reports[index] = structuredClone(report);
        });
      const seeds = pairedSeeds();
      void (async () => {
        try {
          for (let i = 0; i < seeds.length; i++) {
            const changed = structuredClone(snapshot);
            let scenario = command.operation ?? "owner what-if";
            if (command.kind === "what-if")
              controlCity(changed, command.change!, "simulation");
            if (command.kind === "chaos") {
              const kinds = [
                "wildfire",
                "blackout",
                "flood",
                "earthquake",
              ] as const;
              scenario = kinds[i % kinds.length];
              controlCity(
                changed,
                {
                  operation: "hazard.create",
                  kind: kinds[i % kinds.length],
                  x: 980,
                  y: 710,
                  radius: 220,
                  intensity: 0.85,
                },
                "simulation",
              );
              if (i % kinds.length === 2)
                for (const road of changed.roads.filter((r) => r.bridge))
                  if (!road.closed)
                    controlCity(
                      changed,
                      { operation: "road.toggle", roadId: road.id },
                      "simulation",
                    );
            }
            const baseline = await rollout(
              snapshot,
              seeds[i],
              cap.goal!,
              cap,
              this.sandbox,
              false,
            );
            const treatment = await rollout(
              changed,
              seeds[i],
              cap.goal!,
              cap,
              this.sandbox,
              false,
              command.kind === "ablation" ? [command.operation!] : [],
            );
            report.rows.push({
              scenario,
              seed: seeds[i],
              baseline: baseline.rollout,
              treatment: treatment.rollout,
              lossDelta: treatment.rollout.score - baseline.rollout.score,
            });
            await persist();
          }
          report.status = "complete";
          await persist();
        } catch (e) {
          report.status = "failed";
          report.error = (
            e instanceof Error ? e.message : "Experiment failed"
          ).slice(0, 600);
          await persist();
        } finally {
          this.experimenting = false;
        }
      })().catch(() => {
        this.experimenting = false;
      });
      return {
        reportId: report.id,
        status: report.status,
        currentWorldChanged: false,
        trials: 20,
      };
    } catch (e) {
      this.experimenting = false;
      throw e;
    }
  }
}
