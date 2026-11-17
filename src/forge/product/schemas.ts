import Ajv from "ajv/dist/2020.js";
import { digest } from "../hash";
import type { JsonSchema } from "./contracts";

const ajv = new Ajv({
  strict: false,
  allErrors: false,
  validateFormats: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
const cache = new Map<string, ReturnType<typeof ajv.compile>>();
export function assertValidSchema(schema: JsonSchema) {
  ajv.compile(schema);
}
export function validateJson(
  schema: JsonSchema,
  value: unknown,
  label: string,
) {
  const key = digest(schema);
  let validate = cache.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    if (cache.size >= 200) cache.clear();
    cache.set(key, validate);
  }
  if (!validate(value))
    throw new Error(
      `${label} did not match its connected operation schema: ${
        validate.errors
          ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
          .join("; ")
          .slice(0, 400) ?? "invalid structure"
      }`,
    );
  return value;
}
export function boundJson(value: unknown, bytes = 131072) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > bytes)
    throw new Error(
      "Program data exceeds the bounded execution budget; narrow the input",
    );
  return JSON.parse(json) as unknown;
}
export function objectSchema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}
export function stripSchemaMetadata(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      [
        "description",
        "example",
        "examples",
        "$id",
        "$schema",
        "default",
      ].includes(key)
    )
      continue;
    if (
      [
        "properties",
        "$defs",
        "definitions",
        "patternProperties",
        "dependentSchemas",
      ].includes(key) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          child && typeof child === "object"
            ? stripSchemaMetadata(child as JsonSchema)
            : child,
        ]),
      );
    } else if (["const", "enum"].includes(key)) result[key] = value;
    else
      result[key] = Array.isArray(value)
        ? value.map((v) =>
            v && typeof v === "object"
              ? stripSchemaMetadata(v as JsonSchema)
              : v,
          )
        : value && typeof value === "object"
          ? stripSchemaMetadata(value as JsonSchema)
          : value;
  }
  if (result.nullable) {
    delete result.nullable;
    return { anyOf: [result, { type: "null" }] };
  }
  return result;
}
