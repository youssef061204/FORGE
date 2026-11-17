import { parseDocument } from "yaml";
import { z } from "zod";
import type { SecretVault } from "../vault";
import type {
  CallContext,
  ConnectionConfig,
  FabricConnector,
  OperationDescriptor,
} from "./contracts";
import {
  objectSchema,
  stripSchemaMetadata,
  validateJson,
  boundJson,
  assertValidSchema,
} from "./schemas";
import { assertAllowedUrl, ConnectorHttpError, secureFetch } from "./network";

export type ImportedOperation = OperationDescriptor & {
  method: string;
  path: string;
  parameters: { name: string; location: "path" | "query" | "header" }[];
  body: boolean;
};
const record = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
export function parseOpenApi(raw: string | Record<string, unknown>) {
  if (typeof raw !== "string") {
    boundJson(raw, 1048576);
    return record(raw);
  }
  if (Buffer.byteLength(raw) > 1048576)
    throw new Error("OpenAPI import exceeds one megabyte");
  const document = parseDocument(raw, { uniqueKeys: true });
  if (document.errors.length)
    throw new Error("OpenAPI JSON/YAML could not be parsed");
  return record(document.toJS({ maxAliasCount: 0 }));
}
export function extractOpenApi(
  spec: Record<string, unknown>,
  config: Pick<
    ConnectionConfig,
    "id" | "baseUrl" | "domains" | "operationAllowlist"
  >,
): ImportedOperation[] {
  if (!/^3\.[01]\./.test(String(spec.openapi)))
    throw new Error("OpenAPI 3.0 or 3.1 is required");
  assertAllowedUrl(config.baseUrl, config.domains);
  const paths = record(spec.paths);
  let visited = 0;
  function resolve(
    value: unknown,
    ancestors = new Set<string>(),
    depth = 0,
  ): unknown {
    if (++visited > 15000 || depth > 30)
      throw new Error("OpenAPI schema expansion budget exceeded");
    if (Array.isArray(value))
      return value.map((v) => resolve(v, ancestors, depth + 1));
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === "string") {
      const ref = object.$ref;
      if (!ref.startsWith("#/components/") || ancestors.has(ref))
        throw new Error(
          "Remote and recursive OpenAPI references are unavailable",
        );
      let target: unknown = spec;
      for (const segment of ref.slice(2).split("/")) {
        const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error("Invalid OpenAPI reference");
        target = record(target)[key];
      }
      if (!target) throw new Error("Unresolved OpenAPI reference");
      return resolve(target, new Set([...ancestors, ref]), depth + 1);
    }
    return Object.fromEntries(
      Object.entries(object)
        .filter(([k]) => !["__proto__", "prototype", "constructor"].includes(k))
        .map(([k, v]) => [k, resolve(v, ancestors, depth + 1)]),
    );
  }
  const extracted: ImportedOperation[] = [];
  for (const [path, pathValue] of Object.entries(paths)) {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[?#\\]/.test(path) ||
      path.split("/").some((s) => s === ".." || /%2e/i.test(s))
    )
      throw new Error("Unsafe OpenAPI endpoint path");
    const item = record(resolve(pathValue));
    for (const method of ["get", "head", "post", "put", "patch", "delete"]) {
      if (!item[method]) continue;
      const endpoint = record(item[method]);
      const rawId = endpoint.operationId;
      if (
        typeof rawId !== "string" ||
        !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(rawId)
      )
        throw new Error(
          "Imported endpoints need unique, bounded operationId values",
        );
      if (!config.operationAllowlist.includes(rawId)) continue;
      const parameters: ImportedOperation["parameters"] = [];
      const properties: Record<string, unknown> = {},
        required: string[] = [];
      for (const rawParameter of [
        ...(Array.isArray(item.parameters) ? item.parameters : []),
        ...(Array.isArray(endpoint.parameters) ? endpoint.parameters : []),
      ]) {
        const parameter = record(rawParameter);
        const name = String(parameter.name);
        if (
          !["path", "query", "header"].includes(String(parameter.in)) ||
          /authorization|cookie|api.?key|token|secret/i.test(name)
        )
          throw new Error(
            "Authentication parameters must remain in trusted connector configuration",
          );
        if (["__proto__", "constructor", "prototype", "body"].includes(name))
          throw new Error("Invalid endpoint parameter name");
        properties[name] = stripSchemaMetadata(record(parameter.schema));
        if (parameter.required || parameter.in === "path") required.push(name);
        parameters.push({
          name,
          location: parameter.in as "path" | "query" | "header",
        });
      }
      let body = false;
      if (endpoint.requestBody) {
        const requestBody = record(endpoint.requestBody);
        const content = record(requestBody.content);
        if (!content["application/json"])
          throw new Error("Only JSON OpenAPI request bodies are available");
        properties.body = stripSchemaMetadata(
          record(record(content["application/json"]).schema),
        );
        body = true;
        if (requestBody.required) required.push("body");
      }
      const responses = record(endpoint.responses);
      const success = Object.entries(responses).find(([code]) =>
        /^2\d\d$/.test(code),
      );
      if (!success)
        throw new Error("Endpoint needs an explicit success response");
      const response = record(success[1]);
      const responseContent = response.content ? record(response.content) : {};
      const outputSchema = responseContent["application/json"]
        ? stripSchemaMetadata(
            record(record(responseContent["application/json"]).schema),
          )
        : objectSchema();
      const write = !["get", "head"].includes(method);
      const id = config.id + "." + rawId;
      const operation: ImportedOperation = {
        id,
        connector: config.id,
        name: String(endpoint.summary ?? rawId).slice(0, 100),
        description: String(
          endpoint.description ?? endpoint.summary ?? rawId,
        ).slice(0, 500),
        method: method.toUpperCase(),
        path,
        parameters,
        body,
        inputSchema: objectSchema(properties, [...new Set(required)]),
        outputSchema,
        permission: id + (write ? ".write" : ".read"),
        kind: write ? "write" : "read",
        sideEffect:
          method === "delete" ? "irreversible" : write ? "reversible" : "none",
        idempotent: ["get", "head", "put"].includes(method),
      };
      if (extracted.some((o) => o.id === id))
        throw new Error("Duplicate OpenAPI operationId");
      assertValidSchema(operation.inputSchema);
      assertValidSchema(operation.outputSchema);
      extracted.push(operation);
    }
  }
  if (!extracted.length || extracted.length > 100)
    throw new Error(
      "OpenAPI allowlist must select between one and 100 operations",
    );
  return extracted;
}

export class OpenApiConnector implements FabricConnector {
  private operations: ImportedOperation[];
  constructor(
    private config: ConnectionConfig,
    private vault: SecretVault,
    private http = secureFetch,
  ) {
    if (!config.spec) throw new Error("OpenAPI specification is required");
    this.operations = extractOpenApi(config.spec, config);
  }
  async describe() {
    return {
      id: this.config.id,
      name: this.config.name,
      kind: "openapi" as const,
      status: this.config.enabled
        ? ("connected" as const)
        : ("needs_consent" as const),
      mode: "live" as const,
      binding: this.config.binding,
      setup: "/inspect",
      constraints: {
        domains: this.config.domains,
        operationAllowlist: this.config.operationAllowlist,
        rawNetwork: false,
        authentication: "trusted vault",
        redirects: false,
      },
      operations: this.operations.map((op) => ({
        id: op.id,
        connector: op.connector,
        name: op.name,
        description: op.description,
        inputSchema: op.inputSchema,
        outputSchema: op.outputSchema,
        permission: op.permission,
        kind: op.kind,
        sideEffect: op.sideEffect,
        idempotent: op.idempotent,
      })),
    };
  }
  async preflight(id: string, args: Record<string, unknown>) {
    const op = this.operations.find((o) => o.id === id);
    if (!op || !this.config.enabled)
      throw new Error("Imported connector operation is unavailable");
    validateJson(op.inputSchema, args, op.name);
    assertAllowedUrl(this.config.baseUrl, this.config.domains);
    for (const parameter of op.parameters) {
      if (
        parameter.location === "path" &&
        /[/\\]|^\.{1,2}$/.test(String(args[parameter.name]))
      )
        throw new Error("Path parameter cannot change endpoint authority");
      if (
        parameter.location === "header" &&
        (!/^x-[a-z0-9-]+$/i.test(parameter.name) ||
          /host|forward|proxy|origin|referer/i.test(parameter.name))
      )
        throw new Error("Unapproved caller-controlled header");
    }
  }
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    const op = this.operations.find((o) => o.id === id);
    if (!op || !this.config.enabled)
      throw new Error("Imported connector operation is unavailable");
    validateJson(op.inputSchema, args, op.name);
    if (context.mode === "replay" && op.kind === "write")
      throw new Error("Replay cannot call an external write");
    let path = op.path;
    for (const parameter of op.parameters.filter(
      (p) => p.location === "path",
    )) {
      const value = String(args[parameter.name]);
      if (/[/\\]|^\.{1,2}$/.test(value))
        throw new Error("Path parameter cannot change endpoint authority");
      path = path.replace(
        "{" + parameter.name + "}",
        encodeURIComponent(value),
      );
    }
    if (/[{}]/.test(path)) throw new Error("Missing endpoint path parameter");
    const base = new URL(this.config.baseUrl);
    const url = new URL(base.pathname.replace(/\/$/, "") + path, base.origin);
    assertAllowedUrl(url, this.config.domains);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    for (const parameter of op.parameters)
      if (args[parameter.name] !== undefined) {
        if (parameter.location === "query")
          url.searchParams.set(parameter.name, String(args[parameter.name]));
        if (parameter.location === "header") {
          if (
            !/^x-[a-z0-9-]+$/i.test(parameter.name) ||
            /host|forward|proxy|origin|referer/i.test(parameter.name)
          )
            throw new Error("Unapproved caller-controlled header");
          headers[parameter.name] = String(args[parameter.name]);
        }
      }
    const credential = (await this.vault.get("connector:" + this.config.id)) as
      | { kind: "bearer" | "api-key"; token: string; header?: string }
      | undefined;
    if (credential?.kind === "bearer")
      headers.Authorization = "Bearer " + credential.token;
    if (credential?.kind === "api-key") {
      if (!credential.header || !/^x-[a-z0-9-]+$/i.test(credential.header))
        throw new Error("API key header must be a configured X- header");
      headers[credential.header] = credential.token;
    }
    const response = await this.http(
      url,
      {
        method: op.method,
        headers,
        body:
          op.body && args.body !== undefined
            ? JSON.stringify(args.body)
            : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
      this.config.domains,
    );
    if (!response.ok) throw new ConnectorHttpError(response.status);
    const data =
      response.status === 204 || op.method === "HEAD"
        ? {}
        : await response.json();
    validateJson(op.outputSchema, data, op.name + " response");
    return {
      data,
      responseId: response.headers.get("x-request-id") ?? undefined,
      target: op.id,
    };
  }
}
