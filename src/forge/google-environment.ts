import { z } from "zod";
import type { ForgeService } from "./service";
import type { EnvironmentProvider } from "./environment";
import {
  historySchema,
  moduleInputSchema,
  moduleOutputSchema,
} from "./live-contracts";
export type GoogleObservation = {
  label: "CONNECTED ENVIRONMENT";
  connected: boolean;
  calendarWriteConsent: boolean;
  binding: string | null;
  emailsObserved: number;
  eventsObserved: number;
  revision: number;
};
type GoogleAction = { operation: "capability.invoke"; id: string };
type GoogleAuthority = { digest: string; binding: string };
// The existing connector and per-write broker retain all consent, target and
// sender checks. This provider never introduces a second Google execution path.
export class GoogleEnvironmentProvider implements EnvironmentProvider<
  GoogleObservation,
  GoogleAction,
  GoogleAuthority
> {
  private revision = 0;
  constructor(private service: ForgeService) {}
  async observe(): Promise<GoogleObservation> {
    const status = await this.service.google.status();
    if (!status.connected)
      return {
        label: "CONNECTED ENVIRONMENT",
        connected: false,
        calendarWriteConsent: false,
        binding: null,
        emailsObserved: 0,
        eventsObserved: 0,
        revision: this.revision,
      };
    const connector = await this.service.google.connector();
    const history = historySchema.parse(await connector.snapshot());
    return {
      label: "CONNECTED ENVIRONMENT",
      connected: true,
      calendarWriteConsent: status.calendarWriteConsent,
      binding: connector.binding,
      emailsObserved: history.emails.length,
      eventsObserved: history.events.length,
      revision: ++this.revision,
    };
  }
  async query(resourceId: string) {
    if (resourceId === "$capabilities")
      return (await this.service.store.read()).releases
        .filter(
          (r) =>
            r.status === "installed" &&
            r.definition.executable?.interface === "deadline/v1",
        )
        .map((r) => ({ digest: r.digest, definition: r.definition }));
    if (resourceId === "status") return this.service.google.status();
    throw new Error(
      "Raw Google resource contents are available only to the scoped replay/execution broker, never the general descriptor",
    );
  }
  subscribe(listener: (state: GoogleObservation) => void) {
    let active = true,
      pending = false;
    const timer = setInterval(async () => {
      if (pending || !active) return;
      pending = true;
      try {
        const observation = await this.observe();
        if (active) listener(observation);
      } catch {
        /* Connector failures are surfaced by explicit reads/runs, not private background logs. */
      } finally {
        pending = false;
      }
    }, 15000);
    timer.unref();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }
  async execute(raw: GoogleAction[], authority: GoogleAuthority) {
    const actions = z
      .array(
        z
          .object({
            operation: z.literal("capability.invoke"),
            id: z.string().max(64),
          })
          .strict(),
      )
      .length(1)
      .parse(raw);
    const state = await this.service.store.read();
    const release = state.releases.find(
      (r) =>
        r.definition.id === actions[0].id &&
        r.status === "installed" &&
        r.digest === authority.digest &&
        r.definition.executable?.interface === "deadline/v1",
    );
    if (
      !release ||
      state.live?.trust[authority.digest]?.binding !== authority.binding
    )
      throw new Error(
        "Exact installed connector artifact and binding required",
      );
    const result = await this.service.runConnected(
      release.definition.id,
      "google",
    );
    return {
      revision: ++this.revision,
      committed: result.report.externalWrites,
    };
  }
  async describeResources() {
    return {
      observation: await this.observe(),
      privacy:
        "Counts and binding only; raw message/calendar contents remain transient inside the scoped broker",
      calendar: "Only the configured dedicated Calendar",
      senderPolicy: "Owner allowlist; exact normalized address comparison",
    };
  }
  describeCapabilities() {
    return {
      interface: "deadline/v1",
      inputSchema: z.toJSONSchema(moduleInputSchema),
      outputSchema: z.toJSONSchema(moduleOutputSchema),
      operations: [
        "gmail.search",
        "calendar.list",
        "calendar.update",
        "calendar.create",
        "notification.emit",
      ],
      execute:
        "capability.invoke delegates to the existing consent and per-write permission broker",
    };
  }
  describeConstraints() {
    return {
      oauthRequired: true,
      calendarWritesNeedSeparateConsent: true,
      replayRequired: true,
      ownerApprovalRequired: true,
      exactDigestAndBindingRequired: true,
      rawContentsInDescriptors: false,
      timedEventUpdates: false,
      gmailSend: false,
    };
  }
}
