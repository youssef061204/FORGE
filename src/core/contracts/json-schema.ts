/**
 * A small JSON Schema validator for the finite vocabulary FORGE uses.
 * It replaces Ajv inside core/: Ajv compiles validators with `new Function`,
 * which a strict Content Security Policy forbids, and core/ must run in a
 * browser worker unchanged.
 */
export type JsonSchema = Record<string, unknown>;

const ANNOTATIONS = new Set([
  "title",
  "description",
  "default",
  "examples",
  "format",
  "$schema",
  "$id",
  "deprecated",
  "readOnly",
  "writeOnly",
]);
const ASSERTIONS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
]);
const TYPES = new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/** Throws if the schema itself uses anything outside the supported vocabulary. */
export function assertValidSchema(schema: unknown, path = "#"): void {
  if (typeof schema === "boolean") return;
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new SchemaError(`${path}: a schema must be an object or boolean`);
  const s = schema as JsonSchema;
  for (const key of Object.keys(s))
    if (!ASSERTIONS.has(key) && !ANNOTATIONS.has(key)) throw new SchemaError(`${path}: unsupported keyword "${key}"`);
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    for (const t of types) if (typeof t !== "string" || !TYPES.has(t)) throw new SchemaError(`${path}/type: unknown type ${String(t)}`);
  }
  if (s.properties !== undefined) {
    if (!s.properties || typeof s.properties !== "object" || Array.isArray(s.properties))
      throw new SchemaError(`${path}/properties must be an object`);
    for (const [k, v] of Object.entries(s.properties)) assertValidSchema(v, `${path}/properties/${k}`);
  }
  if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some((r) => typeof r !== "string")))
    throw new SchemaError(`${path}/required must list names`);
  for (const k of ["items", "additionalProperties", "not"])
    if (s[k] !== undefined) assertValidSchema(s[k], `${path}/${k}`);
  for (const k of ["anyOf", "oneOf", "allOf"])
    if (s[k] !== undefined) {
      if (!Array.isArray(s[k])) throw new SchemaError(`${path}/${k} must be an array`);
      (s[k] as unknown[]).forEach((c, i) => assertValidSchema(c, `${path}/${k}/${i}`));
    }
  for (const k of ["minItems", "maxItems", "minLength", "maxLength"])
    if (s[k] !== undefined && (!Number.isInteger(s[k]) || (s[k] as number) < 0)) throw new SchemaError(`${path}/${k} must be a count`);
  if (s.enum !== undefined && !Array.isArray(s.enum)) throw new SchemaError(`${path}/enum must be an array`);
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object),
    kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b as object, k) && deepEqual((a as never)[k], (b as never)[k]));
}

/** Returns the first violation as "path: message", or null. */
export function firstError(schema: unknown, value: unknown, path = ""): string | null {
  if (schema === true) return null;
  if (schema === false) return `${path || "/"}: no value is allowed here`;
  const s = schema as JsonSchema;
  if (s.type !== undefined) {
    const types = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
    const actual = typeOf(value);
    const ok = types.some(
      (t) => t === actual || (t === "integer" && actual === "number" && Number.isInteger(value)) || (t === "number" && actual === "number"),
    );
    if (!ok) return `${path || "/"}: expected ${types.join(" or ")}, found ${actual}`;
  }
  if (s.const !== undefined && !deepEqual(s.const, value)) return `${path || "/"}: must equal ${JSON.stringify(s.const)}`;
  if (Array.isArray(s.enum) && !s.enum.some((e) => deepEqual(e, value))) return `${path || "/"}: must be one of ${JSON.stringify(s.enum).slice(0, 80)}`;
  if (typeof value === "number") {
    if (typeof s.minimum === "number" && value < s.minimum) return `${path || "/"}: must be at least ${s.minimum}`;
    if (typeof s.maximum === "number" && value > s.maximum) return `${path || "/"}: must be at most ${s.maximum}`;
    if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum) return `${path || "/"}: must be above ${s.exclusiveMinimum}`;
    if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum) return `${path || "/"}: must be below ${s.exclusiveMaximum}`;
    if (typeof s.multipleOf === "number" && s.multipleOf > 0) {
      const q = value / s.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) return `${path || "/"}: must be a multiple of ${s.multipleOf}`;
    }
  }
  if (typeof value === "string") {
    const len = [...value].length;
    if (typeof s.minLength === "number" && len < s.minLength) return `${path || "/"}: must have at least ${s.minLength} characters`;
    if (typeof s.maxLength === "number" && len > s.maxLength) return `${path || "/"}: must have at most ${s.maxLength} characters`;
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === "number" && value.length < s.minItems) return `${path || "/"}: must have at least ${s.minItems} items`;
    if (typeof s.maxItems === "number" && value.length > s.maxItems) return `${path || "/"}: must have at most ${s.maxItems} items`;
    if (s.uniqueItems === true)
      for (let i = 0; i < value.length; i++)
        for (let j = i + 1; j < value.length; j++) if (deepEqual(value[i], value[j])) return `${path || "/"}: items must be unique`;
    if (s.items !== undefined)
      for (let i = 0; i < value.length; i++) {
        const e = firstError(s.items, value[i], `${path}/${i}`);
        if (e) return e;
      }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(s.required))
      for (const r of s.required as string[]) if (!Object.hasOwn(obj, r)) return `${path || "/"}: missing required "${r}"`;
    for (const [k, v] of Object.entries(obj)) {
      if (Object.hasOwn(props, k)) {
        const e = firstError(props[k], v, `${path}/${k}`);
        if (e) return e;
      } else if (s.additionalProperties !== undefined) {
        const e = firstError(s.additionalProperties, v, `${path}/${k}`);
        if (e) return s.additionalProperties === false ? `${path || "/"}: unexpected property "${k}"` : e;
      }
    }
  }
  if (Array.isArray(s.allOf))
    for (const sub of s.allOf) {
      const e = firstError(sub, value, path);
      if (e) return e;
    }
  if (Array.isArray(s.anyOf) && !s.anyOf.some((sub) => firstError(sub, value, path) === null))
    return `${path || "/"}: does not match any allowed shape`;
  if (Array.isArray(s.oneOf) && s.oneOf.filter((sub) => firstError(sub, value, path) === null).length !== 1)
    return `${path || "/"}: must match exactly one allowed shape`;
  if (s.not !== undefined && firstError(s.not, value, path) === null) return `${path || "/"}: matches a forbidden shape`;
  return null;
}

export function validateJson(schema: JsonSchema, value: unknown, label: string): unknown {
  const error = firstError(schema, value);
  if (error) throw new SchemaError(`${label} did not match its schema: ${error}`);
  return value;
}

/** JSON Schema to a TypeScript type expression (for emitted code). */
export function schemaType(schema: Record<string, unknown>): string {
  if (schema.type === "integer") return "number";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return "(" + union.map((s) => schemaType(s as Record<string, unknown>)).join(" | ") + ")";
  if (Array.isArray(schema.type)) return schema.type.map((type) => schemaType({ ...schema, type })).join(" | ");
  if (schema.type === "array") return "Array<" + schemaType((schema.items ?? {}) as Record<string, unknown>) + ">";
  if (schema.type === "object") {
    const required = (schema.required ?? []) as string[];
    const fields = Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>).map(
      ([name, s]) => JSON.stringify(name) + (required.includes(name) ? "" : "?") + ": " + schemaType(s),
    );
    if (schema.additionalProperties && !fields.length)
      return (
        "Record<string, " +
        (typeof schema.additionalProperties === "object" ? schemaType(schema.additionalProperties as Record<string, unknown>) : "unknown") +
        ">"
      );
    return "{ " + fields.join("; ") + " }";
  }
  return ["string", "number", "boolean", "null"].includes(String(schema.type)) ? String(schema.type) : "unknown";
}
