import { utf8Bytes } from "../table";
import {
  programInputSchema,
  programOutputSchema,
  type ProgramInput,
  type ProgramOutput,
} from "./contracts";
import { validateJson } from "../contracts/json-schema";
import {
  assertIRJson,
  assertIREncodingSchema,
  IRCompileError,
  IR_LIMITS,
  IR_RESERVED_ROOTS,
  IR_UNSAFE_KEYS,
  parseForgeIR,
  type IRAggregate,
  type IRExpr,
  type IRScalarName,
  type IRStep,
  type JsonValue,
} from "./schema";

type Scope = Record<string, JsonValue>;
type Evaluation = { work: number };

function fail(code: string, path: string, message: string): never {
  throw new IRCompileError([{ stage: "evaluate", code, path, message }]);
}
function tick(context: Evaluation, path: string) {
  if (++context.work > IR_LIMITS.work)
    fail("WORK_BUDGET", path, "IR evaluation exceeded its work budget");
}
function collection(value: JsonValue, path: string): JsonValue[] {
  if (!Array.isArray(value))
    fail("EXPECTED_ARRAY", path, "Expected a collection");
  if (value.length > IR_LIMITS.collection)
    fail("COLLECTION_BUDGET", path, "Collection exceeds its row budget");
  return value;
}
function record(value: JsonValue, path: string): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    fail("EXPECTED_OBJECT", path, "Expected an object");
  return value;
}
function text(value: JsonValue, path: string): string {
  if (typeof value !== "string")
    fail("EXPECTED_STRING", path, "Expected a string");
  return value;
}
function number(value: JsonValue, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("EXPECTED_NUMBER", path, "Expected a finite number");
  return value;
}
function boolean(value: JsonValue, path: string): boolean {
  if (typeof value !== "boolean")
    fail("EXPECTED_BOOLEAN", path, "Expected a boolean");
  return value;
}
function scalar(
  value: JsonValue,
  path: string,
): null | string | number | boolean {
  if (value !== null && typeof value === "object")
    fail("EXPECTED_SCALAR", path, "Expected a JSON scalar");
  return value;
}
function finite(value: number, path: string): number {
  if (!Number.isFinite(value))
    fail("NON_FINITE_NUMBER", path, "Arithmetic produced a non-finite number");
  return value;
}
function integer(value: JsonValue, path: string): number {
  const result = number(value, path);
  if (!Number.isInteger(result))
    fail("EXPECTED_INTEGER", path, "Expected an integer");
  return result;
}
function checkedString(value: string, path: string): string {
  if (value.length > IR_LIMITS.planChars)
    fail("STRING_BUDGET", path, "String exceeds its intermediate value budget");
  return value;
}
function key(value: JsonValue): string {
  if (Array.isArray(value)) return "[" + value.map(key).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((name) => JSON.stringify(name) + ":" + key(value[name]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function compare(left: JsonValue, right: JsonValue, path: string): number {
  if (
    (typeof left !== "number" && typeof left !== "string") ||
    typeof left !== typeof right
  )
    fail(
      "INCOMPARABLE_VALUES",
      path,
      "Ordering requires two numbers or two strings",
    );
  if (typeof left === "number" && typeof right === "number")
    return left < right ? -1 : left > right ? 1 : 0;
  const first = text(left, path),
    second = text(right, path);
  return first < second ? -1 : first > second ? 1 : 0;
}
function extend(
  scope: Scope,
  name: string,
  value: JsonValue,
  path: string,
): Scope {
  if (Object.hasOwn(scope, name) || IR_UNSAFE_KEYS.has(name))
    fail(
      "SHADOWED_BINDING",
      path,
      "A lexical binding may not shadow an existing root",
    );
  return { ...scope, [name]: value };
}
function arity(args: IRExpr[], minimum: number, maximum: number, path: string) {
  if (args.length < minimum || args.length > maximum)
    fail(
      "SCALAR_ARITY",
      path,
      `Expected ${minimum === maximum ? minimum : `${minimum}..${maximum}`} arguments`,
    );
}
function parseIso(value: string, path: string): Date {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(
      value,
    );
  if (!match)
    fail(
      "INVALID_ISO_DATE",
      path,
      "Expected an ISO date or an ISO timestamp with an explicit timezone",
    );
  const [year, month, day] = match.slice(1, 4).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day
  )
    fail("INVALID_ISO_DATE", path, "Date contains an invalid calendar day");
  if (
    match[4] !== undefined &&
    (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)
  )
    fail("INVALID_ISO_DATE", path, "Timestamp contains an invalid clock time");
  if (
    match[8] &&
    match[8] !== "Z" &&
    (Number(match[8].slice(1, 3)) > 23 || Number(match[8].slice(4)) > 59)
  )
    fail(
      "INVALID_ISO_DATE",
      path,
      "Timestamp contains an invalid timezone offset",
    );
  const result = match[4] === undefined ? calendar : new Date(value);
  if (
    !Number.isFinite(result.getTime()) ||
    !/^\d{4}-/.test(result.toISOString())
  )
    fail("INVALID_ISO_DATE", path, "Date is outside the supported ISO range");
  return result;
}

function evalScalar(
  op: IRScalarName,
  args: IRExpr[],
  scope: Scope,
  context: Evaluation,
  path: string,
): JsonValue {
  const value = (index: number) =>
    evaluate(args[index], scope, context, `${path}/args/${index}`);
  if (op === "if") {
    arity(args, 3, 3, path);
    return boolean(value(0), path) ? value(1) : value(2);
  }
  if (op === "coalesce") {
    arity(args, 1, 32, path);
    for (let index = 0; index < args.length; index++) {
      const candidate = value(index);
      if (candidate !== null) return candidate;
    }
    return null;
  }
  if (op === "and" || op === "or") {
    arity(args, 1, 32, path);
    for (let index = 0; index < args.length; index++) {
      const candidate = boolean(value(index), path);
      if ((op === "and" && !candidate) || (op === "or" && candidate))
        return candidate;
    }
    return op === "and";
  }
  const one = [
    "number",
    "string",
    "trim",
    "lower",
    "upper",
    "length",
    "round",
    "floor",
    "abs",
    "not",
    "isNull",
    "isoDate",
    "sum",
    "keys",
    "values",
    "entries",
  ];
  const two = [
    "split",
    "join",
    "add",
    "subtract",
    "multiply",
    "divide",
    "modulo",
    "eq",
    "ne",
    "lt",
    "lte",
    "gt",
    "gte",
    "includes",
    "startsWith",
    "endsWith",
    "dateAddDays",
  ];
  if (one.includes(op)) arity(args, 1, 1, path);
  else if (two.includes(op)) arity(args, 2, 2, path);
  else if (op === "replace") arity(args, 3, 3, path);
  else if (op === "slice") arity(args, 2, 3, path);
  else arity(args, 1, 32, path);
  const values = args.map((_, index) => value(index));
  const first = values[0];
  const second = values[1];
  switch (op) {
    case "number": {
      if (typeof first === "number") return number(first, path);
      const source = text(first, path).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(source))
        fail(
          "INVALID_NUMBER",
          path,
          "Numeric conversion requires a complete decimal number",
        );
      return finite(Number(source), path);
    }
    case "string":
      return String(scalar(first, path));
    case "trim":
      return text(first, path).trim();
    case "lower":
      return text(first, path).toLowerCase();
    case "upper":
      return text(first, path).toUpperCase();
    case "split":
      return collection(text(first, path).split(text(second, path)), path);
    case "join":
      return checkedString(
        collection(first, path)
          .map((item) => text(item, path))
          .join(text(second, path)),
        path,
      );
    case "length":
      return typeof first === "string"
        ? first.length
        : collection(first, path).length;
    case "concat":
      return checkedString(
        values.map((item) => text(item, path)).join(""),
        path,
      );
    case "add":
      return finite(number(first, path) + number(second, path), path);
    case "subtract":
      return finite(number(first, path) - number(second, path), path);
    case "multiply":
      return finite(number(first, path) * number(second, path), path);
    case "divide":
    case "modulo": {
      const divisor = number(second, path);
      if (divisor === 0)
        fail(
          "ZERO_DIVISOR",
          path,
          "Division and modulo require a nonzero divisor",
        );
      return finite(
        op === "divide"
          ? number(first, path) / divisor
          : number(first, path) % divisor,
        path,
      );
    }
    case "round":
      return Math.round(number(first, path));
    case "floor":
      return Math.floor(number(first, path));
    case "abs":
      return Math.abs(number(first, path));
    case "sum":
      return collection(first, path).reduce<number>(
        (sum, item) => finite(sum + number(item, path), path),
        0,
      );
    case "min":
    case "max": {
      const candidates =
        values.length === 1 && Array.isArray(first)
          ? collection(first, path)
          : values;
      if (!candidates.length) return null;
      const numbers = candidates.map((item) => number(item, path));
      return op === "min" ? Math.min(...numbers) : Math.max(...numbers);
    }
    case "eq":
      return key(first) === key(second);
    case "ne":
      return key(first) !== key(second);
    case "lt":
      return compare(first, second, path) < 0;
    case "lte":
      return compare(first, second, path) <= 0;
    case "gt":
      return compare(first, second, path) > 0;
    case "gte":
      return compare(first, second, path) >= 0;
    case "not":
      return !boolean(first, path);
    case "isNull":
      return first === null;
    case "includes":
      return typeof first === "string"
        ? first.includes(text(second, path))
        : collection(first, path).some((item) => key(item) === key(second));
    case "startsWith":
      return text(first, path).startsWith(text(second, path));
    case "endsWith":
      return text(first, path).endsWith(text(second, path));
    case "slice": {
      const start = integer(second, path);
      const end = values.length === 3 ? integer(values[2], path) : undefined;
      return typeof first === "string"
        ? first.slice(start, end)
        : collection(first, path).slice(start, end);
    }
    case "replace":
      return checkedString(
        text(first, path).split(text(second, path)).join(text(values[2], path)),
        path,
      );
    case "isoDate":
      return parseIso(text(first, path), path).toISOString().slice(0, 10);
    case "dateAddDays": {
      const date = parseIso(text(first, path), path);
      date.setUTCDate(date.getUTCDate() + integer(second, path));
      if (
        !Number.isFinite(date.getTime()) ||
        !/^\d{4}-/.test(date.toISOString())
      )
        fail(
          "INVALID_ISO_DATE",
          path,
          "Date addition exceeded its supported range",
        );
      return date.toISOString().slice(0, 10);
    }
    case "keys":
      return Object.keys(record(first, path));
    case "values":
      return collection(Object.values(record(first, path)), path);
    case "entries":
      return collection(
        Object.entries(record(first, path)).map(([name, item]) => ({
          key: name,
          value: item,
        })),
        path,
      );
    default:
      return fail("UNKNOWN_SCALAR", path, "Scalar operation is unavailable");
  }
}

function aggregate(
  spec: IRAggregate,
  values: JsonValue[],
  path: string,
): JsonValue {
  if (spec.op === "count") return values.length;
  if (spec.op === "collect") return collection(values, path);
  if (spec.op === "first") return values[0] ?? null;
  if (spec.op === "last") return values.at(-1) ?? null;
  const numbers = values.map((value) => number(value, path));
  if (spec.op === "sum" || spec.op === "mean") {
    const sum = numbers.reduce(
      (result, value) => finite(result + value, path),
      0,
    );
    return spec.op === "sum"
      ? sum
      : numbers.length
        ? finite(sum / numbers.length, path)
        : null;
  }
  if (!numbers.length) return null;
  return spec.op === "min" ? Math.min(...numbers) : Math.max(...numbers);
}

function query(
  source: JsonValue,
  steps: IRStep[],
  scope: Scope,
  context: Evaluation,
  path: string,
): JsonValue {
  let current: JsonValue = collection(source, path);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const here = `${path}/steps/${index}`;
    const rows = collection(current, here);
    const scoped = (name: string, row: JsonValue) => {
      tick(context, here);
      return extend(scope, name, row, here);
    };
    switch (step.op) {
      case "filter":
        current = rows.filter((row) =>
          boolean(
            evaluate(
              step.where,
              scoped(step.as, row),
              context,
              `${here}/where`,
            ),
            here,
          ),
        );
        break;
      case "project":
        current = rows.map((row) =>
          evaluate(step.value, scoped(step.as, row), context, `${here}/value`),
        );
        break;
      case "flatMap": {
        const result: JsonValue[] = [];
        for (const row of rows) {
          result.push(
            ...collection(
              evaluate(
                step.value,
                scoped(step.as, row),
                context,
                `${here}/value`,
              ),
              here,
            ),
          );
          collection(result, here);
        }
        current = result;
        break;
      }
      case "join": {
        const right = collection(
          evaluate(step.right, scope, context, `${here}/right`),
          here,
        );
        const joined: JsonValue[] = [];
        for (const left of rows) {
          let matched = false;
          for (const candidate of right) {
            tick(context, here);
            const binding = extend(
              extend(scope, step.leftAs, left, here),
              step.rightAs,
              candidate,
              here,
            );
            if (
              boolean(evaluate(step.on, binding, context, `${here}/on`), here)
            ) {
              joined.push({ left, right: candidate });
              matched = true;
              collection(joined, here);
            }
          }
          if (!matched && step.mode === "left") {
            joined.push({ left, right: null });
            collection(joined, here);
          }
        }
        current = joined;
        break;
      }
      case "group": {
        const names = [
          ...Object.keys(step.keys),
          ...Object.keys(step.aggregates),
        ];
        if (new Set(names).size !== names.length)
          fail(
            "GROUP_NAME_COLLISION",
            here,
            "Group keys and aggregate names must be distinct",
          );
        const groups = new Map<
          string,
          { keys: Record<string, JsonValue>; rows: JsonValue[] }
        >();
        for (const row of rows) {
          const binding = scoped(step.as, row);
          const keys = Object.fromEntries(
            Object.entries(step.keys).map(([name, expression]) => [
              name,
              scalar(
                evaluate(expression, binding, context, `${here}/keys/${name}`),
                here,
              ),
            ]),
          );
          const id = key(keys);
          const group = groups.get(id) ?? { keys, rows: [] };
          group.rows.push(row);
          groups.set(id, group);
        }
        const grouped: JsonValue[] = [];
        for (const group of groups.values()) {
          const result: Record<string, JsonValue> = { ...group.keys };
          for (const [name, spec] of Object.entries(step.aggregates)) {
            const values =
              spec.op === "count"
                ? group.rows
                : group.rows.map((row) =>
                    evaluate(
                      spec.value,
                      scoped(step.as, row),
                      context,
                      `${here}/aggregates/${name}/value`,
                    ),
                  );
            result[name] = aggregate(spec, values, here);
          }
          grouped.push(result);
        }
        current = collection(grouped, here);
        break;
      }
      case "distinct": {
        const keys = rows.map((row) =>
          step.by
            ? key(
                evaluate(step.by, scoped(step.as, row), context, `${here}/by`),
              )
            : (tick(context, here), key(row)),
        );
        const positions = new Map<string, number>();
        keys.forEach((id, position) => {
          if (step.keep === "last" || !positions.has(id))
            positions.set(id, position);
        });
        current = rows.filter(
          (_, position) => positions.get(keys[position]) === position,
        );
        break;
      }
      case "sort": {
        const decorated = rows.map((row, position) => {
          const binding = scoped(step.as, row);
          return {
            row,
            position,
            values: step.by.map((order, orderIndex) =>
              evaluate(
                order.value,
                binding,
                context,
                `${here}/by/${orderIndex}`,
              ),
            ),
          };
        });
        decorated.sort((left, right) => {
          tick(context, here);
          for (let orderIndex = 0; orderIndex < step.by.length; orderIndex++) {
            const order = step.by[orderIndex];
            const first = left.values[orderIndex],
              second = right.values[orderIndex];
            let result = 0;
            if (first === null || second === null)
              result =
                first === second
                  ? 0
                  : first === null
                    ? order.nulls === "first"
                      ? -1
                      : 1
                    : order.nulls === "first"
                      ? 1
                      : -1;
            else
              result =
                compare(first, second, here) *
                (order.direction === "desc" ? -1 : 1);
            if (result) return result;
          }
          return left.position - right.position;
        });
        current = decorated.map((item) => item.row);
        break;
      }
      case "slice":
        current = rows.slice(step.offset, step.offset + step.limit);
        break;
      case "record": {
        if (index !== steps.length - 1)
          fail(
            "RECORD_NOT_TERMINAL",
            here,
            "A record projection must be the final query step",
          );
        const result: Record<string, JsonValue> = Object.create(null);
        for (const row of rows) {
          const binding = scoped(step.as, row);
          const name = text(
            evaluate(step.key, binding, context, `${here}/key`),
            here,
          );
          if (IR_UNSAFE_KEYS.has(name))
            fail("UNSAFE_KEY", here, "Prototype-related names are unavailable");
          if (Object.hasOwn(result, name)) {
            if (step.duplicates === "first") continue;
            if (step.duplicates !== "last")
              fail(
                "DUPLICATE_RECORD_KEY",
                here,
                "Record projection encountered a duplicate key",
              );
          }
          result[name] = evaluate(
            step.value,
            binding,
            context,
            `${here}/value`,
          );
        }
        current = result;
        break;
      }
    }
  }
  return current;
}

function encode(
  expression: Extract<IRExpr, { kind: "encode" }>,
  scope: Scope,
  context: Evaluation,
  path: string,
): string {
  if (expression.schema !== undefined)
    assertIREncodingSchema(expression.schema, `${path}/schema`);
  const value = evaluate(expression.value, scope, context, `${path}/value`);
  // Schema omission never permits JSON.stringify to erase non-finite values,
  // invalid object shapes, or oversized intermediate collections.
  assertIRJson(value, { nodes: 50000, chars: IR_LIMITS.inputBytes });
  if (expression.schema !== undefined)
    try {
      validateJson(expression.schema, value, "IR encoded value");
    } catch {
      fail(
        "ENCODE_SCHEMA",
        path,
        "Encoded value does not satisfy its declared data schema",
      );
    }
  let result: string;
  if (expression.format === "json") result = JSON.stringify(value);
  else if (expression.format === "text")
    result =
      typeof value === "string"
        ? value
        : collection(value, path)
            .map((item) => text(item, path))
            .join("\n");
  else {
    if (!expression.columns)
      fail("CSV_COLUMNS", path, "CSV encoding requires ordered columns");
    const columns = collection(
      evaluate(expression.columns, scope, context, `${path}/columns`),
      path,
    ).map((item) => text(item, path));
    if (
      !columns.length ||
      columns.length > 20 ||
      new Set(columns).size !== columns.length ||
      columns.some(
        (name) => !name.trim() || name.length > 80 || IR_UNSAFE_KEYS.has(name),
      )
    )
      fail(
        "CSV_COLUMNS",
        path,
        "CSV columns must be distinct ordinary nonempty names within the column budget",
      );
    const cell = (item: JsonValue) => {
      const value = scalar(item, path);
      const source = value === null ? "" : String(value);
      return /[",\r\n]/.test(source)
        ? '"' + source.replaceAll('"', '""') + '"'
        : source;
    };
    const lines = [columns.map(cell).join(",")];
    for (const item of collection(value, path)) {
      tick(context, path);
      const row = record(item, path);
      lines.push(
        columns
          .map((column) => {
            if (!Object.hasOwn(row, column))
              fail(
                "CSV_CELL_MISSING",
                path,
                "CSV row is missing a selected column",
              );
            return cell(row[column]);
          })
          .join(","),
      );
    }
    result = lines.join("\n");
  }
  if (expression.terminalNewline && result && !result.endsWith("\n"))
    result += "\n";
  return checkedString(result, path);
}

function evaluate(
  expression: IRExpr,
  scope: Scope,
  context: Evaluation,
  path: string,
): JsonValue {
  tick(context, path);
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "get": {
      if (!Object.hasOwn(scope, expression.root))
        fail(
          "UNBOUND_ROOT",
          path,
          `Root ${expression.root} is unavailable in this scope`,
        );
      let current = scope[expression.root];
      for (const segment of expression.path) {
        if (typeof segment === "string" && IR_UNSAFE_KEYS.has(segment))
          fail("UNSAFE_KEY", path, "Prototype-related names are unavailable");
        if (current === null) return null;
        if (Array.isArray(current)) {
          if (typeof segment !== "number")
            fail("ARRAY_INDEX", path, "Array paths require numeric indices");
          current = Object.hasOwn(current, segment) ? current[segment] : null;
        } else if (typeof current === "object") {
          if (typeof segment !== "string")
            fail("OBJECT_KEY", path, "Object paths require named fields");
          current = Object.hasOwn(current, segment) ? current[segment] : null;
        } else
          fail(
            "PATH_ON_SCALAR",
            path,
            "A path may not descend through a scalar value",
          );
      }
      return current;
    }
    case "object":
      return Object.fromEntries(
        Object.entries(expression.fields).map(([name, value]) => [
          name,
          evaluate(value, scope, context, `${path}/fields/${name}`),
        ]),
      );
    case "array":
      return collection(
        expression.items.map((value, index) =>
          evaluate(value, scope, context, `${path}/items/${index}`),
        ),
        path,
      );
    case "scalar":
      return evalScalar(expression.op, expression.args, scope, context, path);
    case "query":
      return query(
        evaluate(expression.source, scope, context, `${path}/source`),
        expression.steps,
        scope,
        context,
        path,
      );
    case "encode":
      return encode(expression, scope, context, path);
  }
}

/** A pure reference backend. It neither calls connectors nor proves user intent. */
export function evaluateIR(raw: unknown, input: ProgramInput): ProgramOutput {
  const ir = parseForgeIR(raw);
  assertIRJson(input, { nodes: 50000, chars: IR_LIMITS.inputBytes });
  if (utf8Bytes(JSON.stringify(input)) > IR_LIMITS.inputBytes)
    fail("INPUT_SIZE", "/input", "Input exceeds its byte budget");
  const parsed = programInputSchema.safeParse(input);
  if (!parsed.success)
    fail(
      "INPUT_SCHEMA",
      "/input",
      "Input does not match the program interface",
    );
  const data = parsed.data;
  let scope: Scope = {
    input: data as unknown as JsonValue,
    observations: data.observations as JsonValue,
    params: data.input as JsonValue,
    state: data.state as JsonValue,
    now: data.now,
  };
  const context: Evaluation = { work: 0 };
  for (let index = 0; index < ir.bindings.length; index++) {
    const binding = ir.bindings[index];
    if (
      (IR_RESERVED_ROOTS as readonly string[]).includes(binding.id) ||
      Object.hasOwn(scope, binding.id)
    )
      fail(
        "DUPLICATE_BINDING",
        `/bindings/${index}`,
        "Binding identifiers must be unique and may not replace host roots",
      );
    scope = extend(
      scope,
      binding.id,
      evaluate(binding.value, scope, context, `/bindings/${index}/value`),
      `/bindings/${index}`,
    );
  }
  const operations: ProgramOutput["operations"] = [];
  for (let index = 0; index < ir.effects.length; index++) {
    const effect = ir.effects[index],
      path = `/effects/${index}`;
    const emit = (binding: Scope) => {
      tick(context, path);
      if (
        effect.when &&
        !boolean(evaluate(effect.when, binding, context, `${path}/when`), path)
      )
        return;
      const args = record(
        evaluate(effect.arguments, binding, context, `${path}/arguments`),
        path,
      );
      if (operations.length >= IR_LIMITS.effects)
        fail(
          "EFFECT_BUDGET",
          path,
          "Effect count exceeds its execution budget",
        );
      operations.push({ operation: effect.operation, arguments: args });
    };
    if (effect.forEach) {
      for (const row of collection(
        evaluate(
          effect.forEach.source,
          scope,
          context,
          `${path}/forEach/source`,
        ),
        path,
      ))
        emit(extend(scope, effect.forEach.item, row, `${path}/forEach/item`));
    } else emit(scope);
  }
  const summary = text(
    evaluate(ir.result.summary, scope, context, "/result/summary"),
    "/result/summary",
  );
  const details = ir.result.details
    ? collection(
        evaluate(ir.result.details, scope, context, "/result/details"),
        "/result/details",
      ).map((value) => text(value, "/result/details"))
    : [];
  const state = ir.state
    ? record(evaluate(ir.state, scope, context, "/state"), "/state")
    : {};
  const output = programOutputSchema.safeParse({
    operations,
    result: { summary, details },
    state,
  });
  if (!output.success)
    fail(
      "OUTPUT_SCHEMA",
      "/output",
      "Output does not satisfy the program interface",
    );
  const serialized = JSON.stringify(output.data);
  if (utf8Bytes(serialized) > IR_LIMITS.outputBytes)
    fail("OUTPUT_SIZE", "/output", "Output exceeds its byte budget");
  return JSON.parse(serialized) as ProgramOutput;
}
