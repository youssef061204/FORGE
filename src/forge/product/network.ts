import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { assertPaidActionAllowed } from "../cost-policy";

export class ConnectorHttpError extends Error {
  constructor(readonly status: number) {
    super(`Connected service returned HTTP ${status}`);
  }
}
export function assertAllowedUrl(raw: string | URL, domains: string[]) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "Connector URL must be HTTPS without credentials, fragments or custom ports",
    );
  const host = url.hostname.toLowerCase();
  if (
    !domains.map((d) => d.toLowerCase()).includes(host) ||
    isIP(host) ||
    /(?:^localhost$|\.local$|\.internal$|\.localhost$)/i.test(host)
  )
    throw new Error(
      "Connector destination is outside its approved public domain allowlist",
    );
  return url;
}
function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    address === "::" ||
    address === "::1" ||
    /^f[cd]|^fe[89ab]|^ff|^::ffff:/i.test(address)
  );
}
export async function secureFetch(
  raw: string | URL,
  init: RequestInit,
  domains: string[],
): Promise<Response> {
  // Imported endpoint metadata does not establish that requests are free. Keep
  // this before URL parsing and DNS as well as before HTTP dispatch.
  assertPaidActionAllowed(
    "External connector network access (service pricing is unverified)",
  );
  const url = assertAllowedUrl(raw, domains);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
    throw new Error("Connector resolved to an unapproved network destination");
  const selected = addresses[0];
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        // Pin the previously checked address for this request; preserve hostname
        // verification and SNI. Redirects are never followed.
        lookup: (_host, options, callback) => {
          if (options.all)
            (
              callback as unknown as (
                error: null,
                addresses: { address: string; family: number }[],
              ) => void
            )(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
        signal: init.signal ?? AbortSignal.timeout(15000),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1048576) {
            request.destroy(new Error("Connector response budget exceeded"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          if (status >= 300 && status < 400) {
            reject(new Error("Connector redirects are denied"));
            return;
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
      },
    );
    request.on("error", () =>
      reject(
        new Error(
          "Connected service request failed; no substitute response was used",
        ),
      ),
    );
    if (init.body && typeof init.body !== "string") {
      request.destroy();
      reject(new Error("Connector request body must be serialized JSON"));
      return;
    }
    request.end(init.body ?? undefined);
  });
}
