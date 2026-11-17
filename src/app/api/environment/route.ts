import { z } from "zod";
import { getService } from "@/forge/server";
import { assertAccess, readJson, HttpAccessError } from "@/forge/http";
import {
  simulationControlSchema,
  playerInputSchema,
} from "@/forge/city-contracts";
import { integratePlayer } from "@/forge/city-player";
import { ensureCityFields } from "@/forge/city-terrain";
import { getConfig } from "@/forge/config";
import {
  forecastCity,
  worldModelEvidence,
  setForecastVariant,
  candidateModelEvidence,
} from "@/forge/world-model";
import { monitorForecast } from "@/forge/forecast-monitor";
import kingston from "@/forge/maps/kingston.json";
import { citySchema } from "@/forge/city-contracts";
import { createCity } from "@/forge/city-engine";
import { digest } from "@/forge/hash";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actions = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("model"),
      variant: z.enum(["base", "queue-adapted-2"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("map"),
      name: z.enum(["northbank", "kingston"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("controller"),
      kind: z.enum(["pressure", "optimizer", "rl", "hybrid", "placement"]),
    })
    .strict(),
  z.object({ action: z.literal("player"), input: playerInputSchema }).strict(),
  z
    .object({
      action: z.literal("review-import"),
      digest: z.string().length(64),
    })
    .strict(),
  z
    .object({ action: z.literal("attack"), text: z.string().min(1).max(500) })
    .strict(),
  z
    .object({ action: z.literal("control"), change: simulationControlSchema })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      contestId: z.string().uuid(),
      digest: z.string().length(64),
    })
    .strict(),
  z.object({ action: z.literal("run") }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().max(64) }).strict(),
  z
    .object({
      action: z.literal("rollback"),
      id: z.string().max(64),
      version: z.string().max(40),
    })
    .strict(),
]);
// A single authoritative player. Elapsed time is bounded by the host clock,
// and input sequences cannot replay or teleport persisted position.
let lastPlayerInputAt = 0;
export async function GET(request: Request) {
  try {
    assertAccess(request);
    const service = getService();
    const city = await service.city.provider.observe();
    const state = await service.store.read();
    setForecastVariant(state.forecastVariant ?? "base");
    const config = getConfig();
    const requested = Number(
      new URL(request.url).searchParams.get("forecast") ?? 60,
    );
    const horizon = requested === 30 ? 30 : requested === 120 ? 120 : 60;
    return Response.json(
      {
        city,
        forecast: forecastCity(city, horizon),
        forecastEvidence: worldModelEvidence(),
        modelLifecycle: {
          ...candidateModelEvidence(),
          events: state.modelEvents ?? [],
        },
        forecastMonitor: monitorForecast(city),
        contests:
          new URL(request.url).searchParams.get("compact") === "1"
            ? (state.contests ?? []).map((c) => ({
                ...c,
                candidates: c.candidates.map((candidate) => ({
                  ...candidate,
                  frames: [],
                })),
              }))
            : (state.contests ?? []),
        releases: state.releases,
        executions: state.executions
          .filter(
            (e) =>
              e.outcome.securityProbe === true ||
              state.releases.some(
                (r) =>
                  r.definition.id === e.capabilityId &&
                  r.definition.executable?.interface === "city/v1",
              ),
          )
          .slice(-30),
        trust: state.live?.trust ?? {},
        google: await service.google.status(),
        runtime: {
          mode: config.FORGE_RUNTIME_MODE,
          provider: config.MODEL_PROVIDER,
          model: config.BEDROCK_MODEL_ID ?? null,
          region: process.env.AWS_REGION ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    assertAccess(request);
    const command = actions.parse(await readJson(request));
    const service = getService();
    if (command.action === "model") {
      if (
        command.variant === "queue-adapted-2" &&
        !candidateModelEvidence().validated
      )
        throw new Error("Candidate validation failed");
      await service.store.transaction((s) => {
        s.forecastVariant = command.variant;
        s.modelEvents = [
          ...(s.modelEvents ?? []).slice(-39),
          {
            at: new Date().toISOString(),
            action: command.variant === "base" ? "ROLLBACK" : "PROMOTED_LIVE",
            version: command.variant,
            modelHash:
              command.variant === "base"
                ? candidateModelEvidence().baseModelHash
                : candidateModelEvidence().modelHash,
          },
        ];
      });
      setForecastVariant(command.variant);
      return Response.json(candidateModelEvidence());
    }
    if (command.action === "controller")
      return Response.json(
        await service.city.request(
          "Compare the selected " + command.kind + " controller",
          undefined,
          command.kind,
        ),
      );
    if (command.action === "map") {
      const state = await service.store.read();
      if (
        state.contests?.some((c) =>
          ["generating", "testing", "futures", "observing"].includes(c.status),
        )
      )
        throw new Error(
          "Finish the current program comparison before changing maps",
        );
      const backup = await service.lab.command({
        action: "checkpoint",
        name: "Before map change",
      });
      if (state.city?.deployment) {
        const release = state.releases.find(
          (r) => r.digest === state.city?.deployment?.digest,
        );
        if (release) await service.revoke(release.definition.id);
      }
      await service.store.transaction((s) => {
        const prior = s.mapBackup?.snapshot;
        if (prior && digest(prior) !== s.mapBackup!.hash)
          throw new Error("Map backup integrity failed");
        const next =
          command.name === "kingston"
            ? citySchema.parse(structuredClone(kingston))
            : prior && !prior.map
              ? structuredClone(prior)
              : createCity();
        if (s.city)
          s.mapBackup = {
            snapshot: structuredClone(s.city),
            hash: digest(s.city),
          };
        delete next.deployment;
        s.city = next;
        s.contests = [];
      });
      return Response.json({
        map: command.name,
        checkpoint: backup,
        conditions: "Simulated",
      });
    }
    if (command.action === "player") {
      const now = performance.now();
      const elapsed = Math.min(
        command.input.elapsedMs,
        lastPlayerInputAt ? Math.max(0, now - lastPlayerInputAt) : 100,
        200,
      );
      lastPlayerInputAt = now;
      return Response.json(
        await service.store.transaction((s) => {
          if (!s.city) throw new Error("City is not ready");
          ensureCityFields(s.city);
          const player = s.city.player!;
          if (command.input.sequence <= player.sequence) return { player };
          if (!s.city.paused)
            integratePlayer(s.city, player, command.input, elapsed / 1000);
          player.sequence = command.input.sequence;
          return { player };
        }),
      );
    }
    if (command.action === "review-import")
      return Response.json(await service.city.reviewImported(command.digest));
    if (command.action === "attack")
      return Response.json(await service.city.attack(command.text));
    if (command.action === "control")
      return Response.json(await service.city.control(command.change));
    if (command.action === "approve")
      return Response.json(
        await service.city.approve(command.contestId, command.digest),
      );
    if (command.action === "run")
      return Response.json(await service.city.run());
    if (command.action === "revoke")
      return Response.json(await service.revoke(command.id));
    return Response.json(await service.rollback(command.id, command.version));
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error ? error.message : "Environment operation failed",
    },
    { status: error instanceof HttpAccessError ? error.status : 400 },
  );
}
