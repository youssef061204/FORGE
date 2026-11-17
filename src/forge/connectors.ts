import { randomBytes, createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { SecretVault } from "./vault";
import {
  historySchema,
  type History,
  type ProposedEffect,
} from "./live-contracts";
import { replayHistory, fixtureSenders } from "./replay-fixtures";

export interface Connector {
  readonly mode: "fixture" | "google";
  readonly binding: string;
  readonly trustedSenders: string[];
  snapshot(): Promise<History>;
  write(
    effect: ProposedEffect,
    key: string,
    etag?: string,
  ): Promise<{ id: string; link?: string; etag?: string }>;
}
export class FixtureConnector implements Connector {
  readonly mode = "fixture" as const;
  readonly binding = "judge-fixture-v1";
  readonly trustedSenders = fixtureSenders;
  readonly writes: ProposedEffect[] = [];
  async snapshot() {
    return structuredClone(replayHistory);
  }
  async write(effect: ProposedEffect, key: string) {
    this.writes.push(effect);
    return { id: `fixture-${key}` };
  }
}
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expiresAt: z.number(),
  scope: z.string(),
  binding: z.string(),
});
const flowSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  expiresAt: z.number(),
  writes: z.boolean(),
});
const readScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
export class GoogleConnection {
  constructor(
    readonly vault = new SecretVault(),
    private http: typeof fetch = fetch,
  ) {}
  private config() {
    const client = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    const redirect = process.env.GOOGLE_REDIRECT_URI;
    if (!client || !secret || !redirect)
      throw new Error(
        "Google OAuth is not configured. Follow docs/GOOGLE.md and configure server-only GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
      );
    const url = new URL(redirect);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("OAuth redirect must use HTTPS or loopback HTTP");
    return { client, secret, redirect };
  }
  async status() {
    const raw = await this.vault.get("google");
    const token = tokenSchema.safeParse(raw);
    return {
      configured: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REDIRECT_URI,
      ),
      connected: token.success,
      calendarWriteConsent:
        token.success &&
        token.data.scope
          .split(" ")
          .includes("https://www.googleapis.com/auth/calendar.events"),
      calendarConfigured: Boolean(process.env.GOOGLE_CALENDAR_ID),
      sendersConfigured: Boolean(process.env.GOOGLE_TRUSTED_SENDERS),
      binding: token.success ? token.data.binding : undefined,
    };
  }
  async begin(writes = false) {
    const config = this.config();
    if (process.env.NODE_ENV === "development")
      throw new Error(
        "Google consent requires the production server to avoid development URL logging. Use Docker or npm run build and npm run start.",
      );
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    await this.vault.set("google-flow", {
      state,
      verifier,
      expiresAt: Date.now() + 600000,
      writes,
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.client,
      redirect_uri: config.redirect,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: [
        ...readScopes,
        ...(writes ? ["https://www.googleapis.com/auth/calendar.events"] : []),
      ].join(" "),
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), state };
  }
  async complete(
    code: string,
    state: string,
    cookieState: string,
    callbackUrl: string,
  ) {
    const config = this.config();
    const flow = flowSchema.parse(await this.vault.get("google-flow"));
    if (
      !cookieState ||
      flow.state !== state ||
      state !== cookieState ||
      flow.expiresAt < Date.now() ||
      new URL(callbackUrl).origin !== new URL(config.redirect).origin
    )
      throw new Error("Invalid or expired OAuth state");
    await this.vault.set("google-flow", undefined);
    const response = await this.http("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.client,
        client_secret: config.secret,
        code,
        redirect_uri: config.redirect,
        grant_type: "authorization_code",
        code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Google OAuth token exchange failed (HTTP ${response.status}); reconnect through consent`,
      );
    const result = z
      .object({
        access_token: z.string(),
        refresh_token: z.string().optional(),
        expires_in: z.number(),
        scope: z.string(),
      })
      .parse(await response.json());
    if (readScopes.some((scope) => !result.scope.split(" ").includes(scope)))
      throw new Error("Google read permissions were not granted");
    // Reconnection creates a new identity binding. Old live grants cannot follow it.
    await this.vault.set("google", {
      ...result,
      expiresAt: Date.now() + result.expires_in * 1000,
      binding: randomUUID(),
    });
  }
  async disconnect() {
    await this.vault.set("google", undefined);
  }
  private async token() {
    const token = tokenSchema.parse(await this.vault.get("google"));
    if (token.expiresAt > Date.now() + 60000) return token;
    if (!token.refresh_token)
      throw new Error("Google consent expired; reconnect");
    const config = this.config();
    const response = await this.http("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.client,
        client_secret: config.secret,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Google refresh failed (HTTP ${response.status}); reconnect`,
      );
    const result = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await response.json());
    token.access_token = result.access_token;
    token.expiresAt = Date.now() + result.expires_in * 1000;
    await this.vault.set("google", token);
    return token;
  }
  async request(path: string, init: RequestInit = {}) {
    if (
      !path.startsWith("/gmail/v1/users/me/") &&
      !path.startsWith("/calendar/v3/calendars/")
    )
      throw new Error("Connector destination denied");
    const token = await this.token();
    const response = await this.http(`https://www.googleapis.com${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
        Authorization: `Bearer ${token.access_token}`,
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Google API failed (HTTP ${response.status}); no fixture fallback`,
      );
    return response.json();
  }
  async connector(): Promise<Connector> {
    const status = await this.status();
    if (
      !status.connected ||
      !status.binding ||
      !status.calendarConfigured ||
      !status.sendersConfigured
    )
      throw new Error(
        "Connect Google and configure a dedicated Calendar and approved senders first",
      );
    return new GoogleConnector(this, status.binding);
  }
}
export class GoogleConnector implements Connector {
  readonly mode = "google" as const;
  readonly trustedSenders: string[];
  private calendar: string;
  constructor(
    private connection: GoogleConnection,
    readonly binding: string,
  ) {
    this.trustedSenders = (process.env.GOOGLE_TRUSTED_SENDERS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    this.calendar = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID ?? "");
  }
  async snapshot(): Promise<History> {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const messages = z
      .object({
        messages: z.array(z.object({ id: z.string() })).optional(),
        nextPageToken: z.string().optional(),
      })
      .parse(
        await this.connection.request(
          `/gmail/v1/users/me/messages?maxResults=250&q=${encodeURIComponent(`after:${from} before:${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}`)}`,
        ),
      );
    if (messages.nextPageToken)
      throw new Error(
        "Replay exceeds 250 emails; narrow history before admission",
      );
    const emails: History["emails"] = [];
    for (const { id } of messages.messages ?? []) {
      const message = (await this.connection.request(
        `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      )) as { internalDate: string; payload: MailPart };
      const header = (name: string) =>
        message.payload.headers?.find((h) => h.name.toLowerCase() === name)
          ?.value ?? "";
      const fromHeader = header("from");
      const sender = (fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader)
        .trim()
        .toLowerCase();
      const body = plainText(message.payload);
      emails.push({
        id,
        at: new Date(Number(message.internalDate)).toISOString(),
        from: sender,
        subject: header("subject"),
        body,
      });
    }
    const events = z
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
              etag: z.string().optional(),
              status: z.string().optional(),
            }),
          )
          .optional(),
        nextPageToken: z.string().optional(),
      })
      .parse(
        await this.connection.request(
          `/calendar/v3/calendars/${this.calendar}/events?maxResults=250&singleEvents=true&timeMin=${encodeURIComponent(from + "T00:00:00Z")}&timeMax=${encodeURIComponent(new Date(now.getTime() + 90 * 86400000).toISOString())}`,
        ),
      );
    if (events.nextPageToken)
      throw new Error(
        "Replay exceeds 250 Calendar events; narrow Calendar before admission",
      );
    return historySchema.parse({
      from,
      to,
      emails: emails.sort((a, b) => a.at.localeCompare(b.at)),
      events: (events.items ?? [])
        .filter((e) => e.status !== "cancelled")
        .map((e) => ({
          id: e.id,
          title: e.summary,
          date: (e.start.date ?? e.start.dateTime ?? "").slice(0, 10),
          allDay: Boolean(e.start.date),
          etag: e.etag,
        })),
    });
  }
  async write(effect: ProposedEffect, key: string, etag?: string) {
    if (effect.operation === "notification.emit") return { id: key };
    const date = effect.date!;
    const end = new Date(Date.parse(date) + 86400000)
      .toISOString()
      .slice(0, 10);
    const path = `/calendar/v3/calendars/${this.calendar}/events`;
    const output = z
      .object({
        id: z.string(),
        htmlLink: z.string().optional(),
        etag: z.string().optional(),
      })
      .parse(
        await this.connection.request(
          effect.operation === "calendar.update"
            ? `${path}/${encodeURIComponent(effect.eventRef!)}`
            : path,
          {
            method: effect.operation === "calendar.update" ? "PATCH" : "POST",
            headers: etag ? { "If-Match": etag } : {},
            body: JSON.stringify({
              ...(effect.operation === "calendar.create"
                ? {
                    id: createHash("sha256").update(key).digest("hex"),
                    summary: effect.title,
                    extendedProperties: { private: { forgeEffect: key } },
                  }
                : {}),
              start: { date },
              end: { date: end },
            }),
          },
        ),
      );
    return { id: output.id, link: output.htmlLink, etag: output.etag };
  }
}
type MailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: MailPart[];
};
export function plainText(part: MailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part.parts ?? []).map(plainText).filter(Boolean).join("\n");
}
