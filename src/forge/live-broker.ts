import { z } from "zod";
import { digest } from "./hash";
import type { Connector } from "./connectors";
import {
  moduleInputSchema,
  moduleOutputSchema,
  type History,
  type ProposedEffect,
} from "./live-contracts";
import type { Capability, ForgeEvent, WorkflowNode } from "./spec";
import type { StateStore } from "./store";
import { runExecutable } from "./executable";
import { PermissionDenied } from "./broker";

export type LiveContext = {
  sandboxMode?: "process" | "docker";
  mode: "REPLAY" | "SHADOW" | "LIVE";
  connector: Connector;
  history: History;
  effects: ProposedEffect[];
  moduleOutput?: z.infer<typeof moduleOutputSchema>;
};
export async function performLive(
  node: WorkflowNode,
  cap: Capability,
  event: ForgeEvent,
  store: StateStore,
  context?: LiveContext,
): Promise<Record<string, unknown>> {
  if (!context)
    throw new PermissionDenied(
      "connector access requires explicit replay or deployment context",
    );
  z.string().min(1).max(10000).parse(event.payload.text);
  const email = moduleInputSchema.shape.email.parse(event.payload.email);
  const history = context.history;
  if (!history.emails.some((e) => digest(e) === digest(email)))
    throw new PermissionDenied("email outside authorized snapshot");
  switch (node.operation) {
    case "gmail.search":
      return { email };
    case "calendar.list":
      return { events: history.events };
    case "executable.run": {
      const output = await runExecutable(
        cap.executable!.source,
        {
          email,
          events: history.events,
          trustedSenders: context.connector.trustedSenders,
        },
        context.sandboxMode,
      );
      // Source proposes data, never arbitrary destinations. Independently constrain every write target.
      if (output.change) {
        if (
          !context.connector.trustedSenders.includes(email.from) ||
          output.change.title !== email.subject ||
          !email.body.includes(output.change.date) ||
          (output.change.eventId !== null &&
            !history.events.some(
              (e) =>
                e.id === output.change!.eventId && e.title === email.subject,
            ))
        )
          throw new PermissionDenied(
            "module proposal exceeds approved input scope",
          );
      }
      context.moduleOutput = output;
      return output;
    }
  }
  const output = context.moduleOutput;
  if (!output?.change) return { skipped: true, reason: "No confirmed change" };
  const change = output.change;
  if (
    change.eventId &&
    history.events.find((e) => e.id === change.eventId)?.allDay === false
  )
    throw new PermissionDenied(
      "deadline/v1 may change all-day events only; timed event left untouched",
    );
  const effects: ProposedEffect[] = [];
  const reference = digest(email.id).slice(0, 16);
  if (node.operation === "calendar.update") {
    if (change.eventId)
      effects.push({
        operation: node.operation,
        emailRef: reference,
        eventRef: change.eventId,
        title: change.title,
        date: change.date,
        disposition: "PROPOSED",
      });
    const study = history.events.find(
      (e) => e.title === "Study: " + change.title,
    );
    if (study?.allDay === false)
      throw new PermissionDenied(
        "deadline/v1 may change all-day study blocks only; timed event left untouched",
      );
    const date = new Date(Date.parse(change.date) - 86400000)
      .toISOString()
      .slice(0, 10);
    if (study && study.date !== date)
      effects.push({
        operation: node.operation,
        emailRef: reference,
        eventRef: study.id,
        title: study.title,
        date,
        disposition: "PROPOSED",
      });
  }
  if (node.operation === "calendar.create") {
    if (!change.eventId)
      effects.push({
        operation: node.operation,
        emailRef: reference,
        title: change.title,
        date: change.date,
        disposition: "PROPOSED",
      });
    const studyDate = new Date(Date.parse(change.date) - 86400000)
      .toISOString()
      .slice(0, 10);
    if (!history.events.some((e) => e.title === `Study: ${change.title}`))
      effects.push({
        operation: node.operation,
        emailRef: reference,
        title: `Study: ${change.title}`,
        date: studyDate,
        disposition: "PROPOSED",
      });
  }
  if (node.operation === "notification.emit" && output.notify)
    effects.push({
      operation: node.operation,
      emailRef: reference,
      title: "A deadline change affects the next seven days",
      disposition: "PROPOSED",
    });
  for (const effect of effects) {
    let nextEtag: string | undefined;
    const key = `live:${cap.id}:${digest({ binding: context.connector.binding, effect: { ...effect, emailRef: undefined } })}`;
    if (context.mode === "LIVE") {
      // Serialize authority check and dispatch with owner revocation. A revoke response means any in-flight write finished.
      await store.transaction(async (state) => {
        const trust = state.live?.trust[digest(cap)];
        const installed = state.releases.some(
          (r) => r.digest === digest(cap) && r.status === "installed",
        );
        const permission =
          effect.operation === "notification.emit"
            ? "notification.emit"
            : "calendar.write";
        if (
          state.live?.paused ||
          !installed ||
          trust?.current !== "LIVE" ||
          trust.binding !== context.connector.binding ||
          trust.connector !== context.connector.mode ||
          !trust.grants.includes(permission)
        )
          throw new PermissionDenied(
            `${permission}: live grant missing, revoked, stale or paused`,
          );
        if (state.effects[key]) {
          effect.disposition = "DEDUPLICATED";
          return;
        }
        let receipt: { id: string; link?: string; etag?: string };
        if (effect.operation === "notification.emit") receipt = { id: key };
        else
          receipt = await context.connector.write(
            effect,
            key,
            history.events.find((e) => e.id === effect.eventRef)?.etag,
          );
        state.effects[key] = {
          kind: "notification",
          content: JSON.stringify({
            connector: context.connector.mode,
            operation: effect.operation,
            externalId: receipt.id,
            link: receipt.link,
          }),
          createdAt: new Date().toISOString(),
          capabilityId: cap.id,
          eventId: event.id,
        };
        effect.disposition = "COMMITTED";
        effect.externalId = receipt.id;
        effect.link = receipt.link;
        nextEtag = receipt.etag;
      });
    }
    context.effects.push(effect);
    if (effect.operation === "calendar.update") {
      const target = history.events.find((e) => e.id === effect.eventRef)!;
      target.date = effect.date!;
      if (nextEtag) target.etag = nextEtag;
    } else if (effect.operation === "calendar.create")
      history.events.push({
        id: effect.externalId ?? digest(key).slice(0, 24),
        title: effect.title,
        date: effect.date!,
        etag: nextEtag,
        allDay: true,
      });
  }
  return {
    proposed: effects.length,
    mode: context.mode,
    connector: context.connector.mode,
    committed: effects.filter((e) => e.disposition === "COMMITTED").length,
  };
}
