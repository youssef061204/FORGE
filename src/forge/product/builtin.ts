import { createHash } from "node:crypto";
import { z } from "zod";
import { plainText, type GoogleConnection } from "../connectors";
import type { StateStore } from "../store";
import type {
  FabricConnector,
  CallContext,
  OperationDescriptor,
} from "./contracts";
import { objectSchema } from "./schemas";
import { TwinEnvironmentProvider } from "../environment";
import { citySchema } from "../city-contracts";

const text = { type: "string", minLength: 1, maxLength: 300 };
const timestamp = { type: "string", minLength: 10, maxLength: 40 };
const eventJson = objectSchema(
  {
    id: text,
    title: text,
    start: timestamp,
    end: timestamp,
    etag: { type: "string" },
  },
  ["id", "title", "start", "end"],
);
const emailJson = objectSchema(
  {
    id: text,
    at: timestamp,
    from: text,
    subject: text,
    body: { type: "string", maxLength: 12000 },
  },
  ["id", "at", "from", "subject", "body"],
);
const eventInput = { title: text, start: timestamp, end: timestamp };
const calendarOperations: OperationDescriptor[] = [
  {
    id: "calendar.list",
    connector: "calendar",
    name: "Read Calendar",
    description:
      "Read at most 100 events from the owner-configured dedicated Calendar, including timed study and interview blocks",
    inputSchema: objectSchema(),
    outputSchema: objectSchema(
      {
        events: { type: "array", items: eventJson, maxItems: 100 },
        timeZone: text,
      },
      ["events", "timeZone"],
    ),
    permission: "calendar.read",
    kind: "read",
    sideEffect: "none",
    idempotent: true,
  },
  ...["create", "update"].map((action) => ({
    id: "calendar." + action,
    connector: "calendar",
    name:
      action === "create" ? "Create Calendar events" : "Edit Calendar events",
    description:
      action === "create"
        ? "Create a bounded all-day or timed event in the dedicated Calendar; no attendees or outbound invitations"
        : "Update only an event observed in the current Calendar snapshot, using its provider etag",
    inputSchema: objectSchema(
      { ...eventInput, ...(action === "update" ? { eventId: text } : {}) },
      ["title", "start", "end", ...(action === "update" ? ["eventId"] : [])],
    ),
    outputSchema: objectSchema({ id: text }, ["id"]),
    permission: "calendar." + action + ".write",
    kind: "write" as const,
    sideEffect: "reversible" as const,
    idempotent: true,
  })),
];
export class GoogleFabricConnector implements FabricConnector {
  constructor(
    private kind: "gmail" | "calendar",
    private google: GoogleConnection,
  ) {}
  async describe() {
    const status = await this.google.status();
    const resources =
      this.kind === "gmail"
        ? status.sendersConfigured
        : status.calendarConfigured;
    const operations =
      this.kind === "calendar"
        ? calendarOperations
        : [
            {
              id: "gmail.search",
              connector: "gmail",
              name: "Read authorized email",
              description:
                "Read recent email from the owner's exact approved-sender allowlist; private message content stays transient",
              inputSchema: objectSchema({
                query: { type: "string", maxLength: 300 },
              }),
              outputSchema: objectSchema(
                {
                  emails: { type: "array", items: emailJson, maxItems: 50 },
                  trustedSenders: { type: "array", items: text },
                  from: timestamp,
                  to: timestamp,
                },
                ["emails", "trustedSenders", "from", "to"],
              ),
              permission: "gmail.read",
              kind: "read" as const,
              sideEffect: "none" as const,
              idempotent: true,
            },
          ];
    return {
      id: this.kind,
      name: this.kind === "gmail" ? "Gmail" : "Google Calendar",
      kind: "builtin" as const,
      status:
        status.connected && resources
          ? ("connected" as const)
          : status.configured
            ? ("needs_consent" as const)
            : ("not_configured" as const),
      mode: "live" as const,
      binding: status.binding ?? "google-unconnected",
      setup: "/live",
      constraints: {
        calendar: "owner-configured dedicated Calendar",
        calendarWritesConsented: status.calendarWriteConsent,
        approvedSendersOnly: this.kind === "gmail",
        tokensExposed: false,
        outboundEmail: false,
        maxEvents: 100,
        maxEmails: 50,
        readHistoryDays: 30,
        writeWindowDays: 180,
      },
      operations,
    };
  }
  private calendarPath() {
    const id = process.env.GOOGLE_CALENDAR_ID;
    if (!id)
      throw new Error(
        "Choose a dedicated Calendar in the Google connection settings",
      );
    return "/calendar/v3/calendars/" + encodeURIComponent(id) + "/events";
  }
  async preflight(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    if (!["calendar.create", "calendar.update"].includes(id)) return;
    const status = await this.google.status();
    if (context.mode === "live" && !status.calendarWriteConsent)
      throw new Error(
        "Google Calendar edit consent is missing; reconnect with Calendar editing enabled",
      );
    const start = String(args.start),
      end = String(args.end);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const valid = (value: string) =>
      Number.isFinite(Date.parse(value)) &&
      (dateOnly.test(value)
        ? new Date(value).toISOString().slice(0, 10) === value
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value));
    if (
      !valid(start) ||
      !valid(end) ||
      Date.parse(end) <= Date.parse(start) ||
      dateOnly.test(start) !== dateOnly.test(end) ||
      Math.abs(Date.parse(start) - Date.parse(context.now)) > 180 * 86400000 ||
      Date.parse(end) - Date.parse(start) > 14 * 86400000
    )
      throw new Error(
        "Calendar change is outside its bounded date/time window",
      );
    const events = Object.values(context.observations).flatMap((value) =>
      value &&
      typeof value === "object" &&
      "events" in value &&
      Array.isArray(value.events)
        ? value.events
        : [],
    ) as { id: string; etag?: string }[];
    if (
      id === "calendar.update" &&
      !events.some((event) => event.id === args.eventId && event.etag)
    )
      throw new Error(
        "Calendar update target must be present with an etag in the authorized snapshot",
      );
  }
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    if (id === "gmail.search") {
      const trustedSenders = (process.env.GOOGLE_TRUSTED_SENDERS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (
        !trustedSenders.length ||
        trustedSenders.some(
          (s) => !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(s),
        )
      )
        throw new Error(
          "Configure exact approved Gmail senders before reading history",
        );
      const now = Date.parse(context.now);
      const from = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
      const to = new Date(now).toISOString().slice(0, 10);
      const q = `after:${from} {${trustedSenders.map((s) => "from:" + s).join(" ")}}`;
      const list = z
        .object({
          messages: z.array(z.object({ id: z.string() })).optional(),
          nextPageToken: z.string().optional(),
        })
        .parse(
          await this.google.request(
            "/gmail/v1/users/me/messages?" +
              new URLSearchParams({ maxResults: "50", q }),
          ),
        );
      if (list.nextPageToken)
        throw new Error(
          "Authorized Gmail history exceeds 50 messages; narrow the sender scope before replay",
        );
      const emails: {
        id: string;
        at: string;
        from: string;
        subject: string;
        body: string;
      }[] = [];
      for (const message of list.messages ?? []) {
        const raw = z
          .object({
            internalDate: z.string(),
            payload: z.record(z.string(), z.unknown()),
          })
          .parse(
            await this.google.request(
              "/gmail/v1/users/me/messages/" +
                encodeURIComponent(message.id) +
                "?format=full",
            ),
          );
        const payload = raw.payload as Parameters<typeof plainText>[0];
        const header = (name: string) =>
          payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ??
          "";
        const sender = (
          header("from").match(/<([^>]+)>/)?.[1] ?? header("from")
        )
          .trim()
          .toLowerCase();
        if (!trustedSenders.includes(sender)) continue;
        const body = plainText(payload);
        if (body.length > 12000)
          throw new Error(
            "Authorized email exceeds the bounded text budget; narrow history before using it",
          );
        const query = String(args.query ?? "").toLowerCase();
        if (
          query &&
          !(header("subject") + " " + body).toLowerCase().includes(query)
        )
          continue;
        emails.push({
          id: message.id,
          at: new Date(Number(raw.internalDate)).toISOString(),
          from: sender,
          subject: header("subject"),
          body,
        });
      }
      return {
        data: { emails, trustedSenders, from, to },
        target: "Approved Gmail history",
      };
    }
    if (id === "calendar.list") {
      const now = Date.parse(context.now);
      const query = new URLSearchParams({
        maxResults: "100",
        singleEvents: "true",
        timeMin: new Date(now - 30 * 86400000).toISOString(),
        timeMax: new Date(now + 180 * 86400000).toISOString(),
      });
      const response = z
        .object({
          items: z
            .array(
              z.object({
                id: z.string(),
                summary: z.string().default("Untitled"),
                start: z.object({
                  date: z.string().optional(),
                  dateTime: z.string().optional(),
                }),
                end: z.object({
                  date: z.string().optional(),
                  dateTime: z.string().optional(),
                }),
                etag: z.string().optional(),
                status: z.string().optional(),
              }),
            )
            .optional(),
          nextPageToken: z.string().optional(),
          timeZone: z.string().optional(),
        })
        .parse(await this.google.request(this.calendarPath() + "?" + query));
      if (response.nextPageToken)
        throw new Error(
          "Calendar history exceeds 100 events; narrow the dedicated Calendar before replay",
        );
      return {
        data: {
          events: (response.items ?? [])
            .filter((event) => event.status !== "cancelled")
            .map((event) => ({
              id: event.id,
              title: event.summary,
              start: event.start.date ?? event.start.dateTime ?? "",
              end: event.end.date ?? event.end.dateTime ?? "",
              ...(event.etag ? { etag: event.etag } : {}),
            })),
          timeZone: response.timeZone ?? "UTC",
        },
        target: "Dedicated Calendar",
      };
    }
    if (!["calendar.create", "calendar.update"].includes(id))
      throw new Error("Unknown Google operation");
    if (context.mode === "replay")
      throw new Error("Replay cannot write to Google");
    const status = await this.google.status();
    if (!status.calendarWriteConsent)
      throw new Error(
        "Google Calendar edit consent is missing; reconnect with Calendar editing enabled",
      );
    const start = String(args.start),
      end = String(args.end);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const day = dateOnly.test(start) && dateOnly.test(end);
    const valid = (value: string) =>
      Number.isFinite(Date.parse(value)) &&
      (dateOnly.test(value)
        ? new Date(value).toISOString().slice(0, 10) === value
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value));
    if (
      !valid(start) ||
      !valid(end) ||
      Date.parse(end) <= Date.parse(start) ||
      dateOnly.test(start) !== dateOnly.test(end) ||
      Math.abs(Date.parse(start) - Date.parse(context.now)) > 180 * 86400000 ||
      Date.parse(end) - Date.parse(start) > 14 * 86400000
    )
      throw new Error(
        "Calendar change is outside its bounded date/time window",
      );
    const observedEvents = Object.values(context.observations).flatMap(
      (value) =>
        value &&
        typeof value === "object" &&
        "events" in value &&
        Array.isArray(value.events)
          ? value.events
          : [],
    ) as { id: string; etag?: string }[];
    const target = observedEvents.find((event) => event.id === args.eventId);
    if (id === "calendar.update" && (!target || !target.etag))
      throw new Error(
        "Calendar update target must be present with an etag in the authorized snapshot",
      );
    const eventId =
      id === "calendar.update"
        ? String(args.eventId)
        : createHash("sha256").update(context.key).digest("hex");
    const body = {
      summary: args.title,
      start: day ? { date: start } : { dateTime: start },
      end: day ? { date: end } : { dateTime: end },
      ...(id === "calendar.create"
        ? {
            id: eventId,
            extendedProperties: { private: { forgeEffect: context.key } },
          }
        : {}),
    };
    const response = z.object({ id: z.string() }).parse(
      await this.google.request(
        this.calendarPath() +
          (id === "calendar.update" ? "/" + encodeURIComponent(eventId) : "") +
          "?sendUpdates=none",
        {
          method: id === "calendar.update" ? "PATCH" : "POST",
          headers: target?.etag ? { "If-Match": target.etag } : {},
          body: JSON.stringify(body),
        },
      ),
    );
    return {
      data: { id: response.id },
      responseId: response.id,
      target:
        "Calendar event " +
        createHash("sha256").update(eventId).digest("hex").slice(0, 12),
    };
  }
}

export class LocalNotificationConnector implements FabricConnector {
  async describe() {
    return {
      id: "notifications",
      name: "Local notifications",
      kind: "builtin" as const,
      status: "connected" as const,
      mode: "live" as const,
      binding: "local-owner-notifications-v1",
      setup: "",
      constraints: {
        delivery: "FORGE Activity and in-app receipts",
        outboundCommunication: false,
      },
      operations: [
        {
          id: "notification.emit",
          connector: "notifications",
          name: "Notify me",
          description: "Record an in-app notification for the current owner",
          inputSchema: objectSchema(
            { message: { type: "string", minLength: 1, maxLength: 300 } },
            ["message"],
          ),
          outputSchema: objectSchema({ delivered: { type: "boolean" } }, [
            "delivered",
          ]),
          permission: "notification.emit",
          kind: "write" as const,
          sideEffect: "reversible" as const,
          idempotent: true,
        },
      ],
    };
  }
  async invoke(
    _id: string,
    _args: Record<string, unknown>,
    context: CallContext,
  ) {
    if (context.mode === "replay")
      throw new Error("Replay notifications are proposed only");
    return {
      data: { delivered: true },
      responseId: context.key,
      target: "Owner's FORGE Activity",
    };
  }
}
export class TwinFabricConnector implements FabricConnector {
  constructor(private store: StateStore) {}
  async describe() {
    return {
      id: "twin",
      name: "FORGE Twin",
      kind: "builtin" as const,
      status: "connected" as const,
      mode: "simulation" as const,
      binding: "forge-city-digital-twin-v1",
      setup: "/twin",
      constraints: {
        physicalInfrastructure: false,
        execution: "Existing City compiler, Futures and permission broker",
        writes:
          "Twin programs use the existing city/v1 pipeline and owner approval",
      },
      operations: [
        {
          id: "twin.observe",
          connector: "twin",
          name: "Observe the Digital Twin",
          description:
            "Read the simulated City, hazards and operational state; observations are not real infrastructure",
          inputSchema: objectSchema(),
          outputSchema: z.toJSONSchema(citySchema),
          permission: "city.read",
          kind: "read" as const,
          sideEffect: "none" as const,
          idempotent: true,
        },
      ],
    };
  }
  async invoke(id: string) {
    if (id !== "twin.observe")
      throw new Error("Use the existing City broker for Twin control");
    return {
      data: await new TwinEnvironmentProvider(this.store).observe(),
      target: "Simulated City",
    };
  }
}
