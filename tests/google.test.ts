import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleConnection, GoogleConnector } from "../src/forge/connectors";
import { SecretVault } from "../src/forge/vault";
afterEach(() => vi.unstubAllEnvs());
function env() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "TEST-PRIVATE-SECRET");
  vi.stubEnv(
    "GOOGLE_REDIRECT_URI",
    "http://127.0.0.1:3108/api/google/callback",
  );
  vi.stubEnv("GOOGLE_CALENDAR_ID", "test-calendar");
  vi.stubEnv("GOOGLE_TRUSTED_SENDERS", "professor@example.edu");
}
it("OAuth uses PKCE, cookie-bound state and server-only token exchange; wrong state never reaches the token endpoint", async () => {
  env();
  const directory = await mkdtemp(join(tmpdir(), "forge-oauth-"));
  try {
    const http = vi.fn().mockResolvedValue(
      Response.json({
        access_token: "TEST-ACCESS",
        refresh_token: "TEST-REFRESH",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events.readonly",
      }),
    );
    const connection = new GoogleConnection(
      new SecretVault(directory),
      http as typeof fetch,
    );
    const flow = await connection.begin();
    const url = new URL(flow.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(flow.url).not.toContain("TEST-PRIVATE-SECRET");
    await expect(
      connection.complete(
        "code",
        flow.state,
        "wrong",
        "http://127.0.0.1:3108/api/google/callback",
      ),
    ).rejects.toThrow("OAuth state");
    expect(http).not.toHaveBeenCalled();
    await connection.complete(
      "code",
      flow.state,
      flow.state,
      "http://127.0.0.1:3108/api/google/callback",
    );
    expect((await connection.status()).connected).toBe(true);
    expect(JSON.stringify(await connection.status())).not.toContain(
      "TEST-ACCESS",
    );
    expect(http.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    await expect(
      connection.complete(
        "code",
        flow.state,
        flow.state,
        "http://127.0.0.1:3108/api/google/callback",
      ),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("Google REST adapter reads Gmail and Calendar and emits real API-shaped create/update requests; these are injected HTTP responses, not live Google evidence", async () => {
  env();
  const directory = await mkdtemp(join(tmpdir(), "forge-google-contract-"));
  try {
    const vault = new SecretVault(directory);
    await vault.set("google", {
      access_token: "TEST-ACCESS",
      refresh_token: "TEST-REFRESH",
      expiresAt: Date.now() + 3600000,
      scope: "read",
      binding: "test-binding",
    });
    const http = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ messages: [{ id: "mail" }] }))
      .mockResolvedValueOnce(
        Response.json({
          internalDate: String(Date.now()),
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "Professor <professor@example.edu>" },
              { name: "Subject", value: "Assignment" },
            ],
            body: {
              data: Buffer.from("Deadline changed to 2026-10-19.").toString(
                "base64url",
              ),
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              id: "event",
              summary: "Assignment",
              start: { date: "2026-10-18" },
              etag: "etag-old",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "new-event",
          htmlLink: "https://calendar.google.com/mock",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "event",
          htmlLink: "https://calendar.google.com/mock",
          etag: "etag-new",
        }),
      );
    const connector = new GoogleConnector(
      new GoogleConnection(vault, http as typeof fetch),
      "test-binding",
    );
    const history = await connector.snapshot();
    expect(history.emails[0].from).toBe("professor@example.edu");
    expect(history.events[0]).toMatchObject({ allDay: true, etag: "etag-old" });
    await connector.write(
      {
        operation: "calendar.create",
        emailRef: "hash",
        title: "Study: Assignment",
        date: "2026-10-18",
        disposition: "PROPOSED",
      },
      "stable-key",
    );
    const updated = await connector.write(
      {
        operation: "calendar.update",
        emailRef: "hash",
        eventRef: "event",
        title: "Assignment",
        date: "2026-10-19",
        disposition: "PROPOSED",
      },
      "stable-update",
      "etag-old",
    );
    expect(updated.etag).toBe("etag-new");
    expect(http.mock.calls[3][1].method).toBe("POST");
    expect(JSON.parse(http.mock.calls[3][1].body).id).toMatch(/^[a-f0-9]{64}$/);
    expect(http.mock.calls[4][1]).toMatchObject({
      method: "PATCH",
      headers: { "If-Match": "etag-old" },
    });
    expect(JSON.parse(http.mock.calls[4][1].body)).toMatchObject({
      start: { date: "2026-10-19" },
      end: { date: "2026-10-20" },
    });
    expect(
      http.mock.calls.every((call) =>
        String(call[0]).startsWith("https://www.googleapis.com/"),
      ),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
