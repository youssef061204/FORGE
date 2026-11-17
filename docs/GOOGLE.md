# Google Live setup

**Status: implemented and contract-tested; an actual Google Calendar write has not been verified.** Google OAuth was not configured in this workspace. Fixture replay runs immediately without credentials. AWS compiler mode and Google connector mode are independent.

## Configure consent

1. In a Google Cloud project, enable Gmail API and Google Calendar API.
2. Configure Google Auth Platform branding, audience and data access. For a personal demonstration, use Testing and add your own Google identity as a test user. Do not publish an unverified application as a production connector.
3. Create an OAuth client of type Web application. Register the exact redirect URI `http://127.0.0.1:3108/api/google/callback` for the default local production server. HTTPS is required outside loopback.
4. Create a separate Google Calendar called FORGE Demo. Copy its Calendar ID from Calendar settings → Integrate calendar. The connector needs that ID; it does not default to your primary Calendar.
5. Configure approved sender addresses. Sender matching is an exact normalized address comparison. This is an application allowlist, not a claim that FORGE independently authenticates the sender's identity or detects spoofed email headers.

For Docker, create a private, gitignored `.env.google` containing:

```dotenv
GOOGLE_CLIENT_ID=your-web-client-id
GOOGLE_CLIENT_SECRET=your-private-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:3108/api/google/callback
GOOGLE_CALENDAR_ID=your-dedicated-calendar-id
GOOGLE_TRUSTED_SENDERS=your-approved-test-sender-address
```

```bash
docker compose -f compose.yaml -f compose.google.yaml up --build -d --wait
```

For a host production server, put those settings in `.env.local`, then run `npm run build` and `npm run start -- --port 3108`. OAuth initiation is disabled in Next's development server to avoid development access logs recording authorization-code query strings. Never print `.env.google`, connector tokens, Docker environment configuration or the vault key into a demo/log.

Open `/live`, select LIVE GOOGLE and connect read access. Consent requests `gmail.readonly` and `calendar.events.readonly`. The separate Authorize Calendar writes button adds `calendar.events`. The provider scope covers event writes, but the broker restricts each capability to the configured Calendar and its approved operations. No Gmail send scope is requested.

## Demonstrate a real write

Use an email in your authorized Gmail history, from an allowlisted sender, whose subject is exactly the title of an all-day event in FORGE Demo. The body must contain an explicit supported phrase:

```text
Subject: FORGE Test Assignment
Body: Deadline changed to YYYY-MM-DD.
```

Replace the date with a real ISO date different from the Calendar event's existing date. `Deadline moved to YYYY-MM-DD` also works, case insensitively. This first interface intentionally requires explicit ISO dates; it does not interpret every possible professor email, ambiguous dates, attachments or HTML-only messages.

1. Authorize Calendar write consent before the final proving replay. Reconnection creates a new connector binding and invalidates old live grants.
2. Build Deadline Guardian through the conversational MCP flow. It is generated on request, not installed as an initial tool.
3. Run Reality Replay on LIVE GOOGLE. It reads up to 250 messages from the last 30 days and up to 250 events from the selected Calendar. If pagination exceeds either budget, admission stops instead of silently using incomplete history.
4. Inspect the proposed Calendar changes and zero external writes. Real history has no accuracy score unless independently labeled.
5. Approve the tested capability, then approve the exact permission delta. Both decisions are owner actions; `forge.approve` only requests review.
6. Run LIVE GOOGLE. A changed existing deadline is PATCHed using its ETag; successful responses refresh the in-memory ETag for consecutive changes. A missing deadline is created. Study placeholders are all-day events on the preceding day. Existing matching study placeholders shift through Calendar update. Timed deadline/study updates are denied rather than converted to all-day events.
7. Select the changed event in the recorded timeline and open its returned Google Calendar link. Confirm the change externally. A live trace and API receipt must exist before recording live success.
8. Revoke live access. Re-running is denied, and polling is disabled. Global Pause live capabilities also blocks dispatch and broker writes.

Notification emission is a persisted local in-app effect, not outbound email or push delivery. Successful live emails receive durable hashed processing markers, so polling does not repeatedly move dates back and forth through old history. Shadow does not mark emails as committed.

## Credentials and privacy

OAuth uses server-side authorization-code exchange, PKCE S256, a one-time expiring state, and a matching HttpOnly SameSite=Lax browser cookie. Tokens never enter application JSON responses, localStorage, generated source or capsules. A successful reconnection clears old Google deployment grants.

Tokens and local signing keys are encrypted with AES-256-GCM in `FORGE_DATA_DIR/secrets.enc`. The default local encryption key is `vault.key`, created with mode 0600; Linux files are owner-only. For stronger separation, supply a 32-byte hex `FORGE_VAULT_KEY` through your private server environment. Restrict the data directory's NTFS ACL to your identity on Windows. A local key beside encrypted data does not protect against a complete compromise of the server filesystem.

Raw Google snapshots stay in memory for the run. Persisted reports retain counts, timestamps, hashed message references and redacted action descriptions. Calendar IDs/API receipts and returned links are kept for operation/audit; email bodies, subjects, event titles and dates are withheld from Google replay summaries and execution outcomes. At most 20 replay/run summaries are retained; execution history persists until deletion. Delete replay evidence clears summaries and linked traces and revokes deployment grants. Disconnect drops locally stored tokens; manage the remaining provider authorization in your Google connected-app settings.

Bedrock receives the capability goal and previous software definition, never the historical snapshot. Do not put private content into your goal/source. Capsule export excludes request prose and rejects recognizable email addresses/token/key patterns, but arbitrary embedded secrets cannot be reliably identified by pattern matching; inspect generated source before sharing.

The current live dispatcher is one process with a serialized local state store. DynamoDB is supported for the existing registry adapter, but Google live dispatch through that optimistic snapshot adapter is deliberately refused. A distributed deployment needs transactional leases and stronger delivery recovery.

Primary implementation references: [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [token storage guidance](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Calendar event API](https://developers.google.com/workspace/calendar/api/v3/reference).
