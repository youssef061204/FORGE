import { CodecError, encodeDelimited, parseDelimited } from "./csv";
import { columnsOf, isRecord, type Json, type Row, type Table } from "../table";

export { CodecError, encodeCell, encodeDelimited, parseDelimited } from "./csv";

export const formats = ["csv", "tsv", "json", "text"] as const;
export type Format = (typeof formats)[number];

export function formatFromName(name: string): Format | undefined {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "tsv" || ext === "tab") return "tsv";
  if (ext === "json" || ext === "jsonl" || ext === "ndjson") return "json";
  if (ext === "txt" || ext === "log" || ext === "md" || ext === "text")
    return "text";
  return undefined;
}

/** Guess a format from content when the name doesn't say (pasted tables). */
export function sniffFormat(text: string): Format {
  const head = text.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      /* fall through */
    }
  }
  const first = head.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("\t")) return "tsv";
  if (first.includes(",") && head.split(/\r?\n/).length > 1) return "csv";
  return "text";
}

export type Decoded = { table: Table; root?: Json; tablePath?: string[] };

/** Find the most table-like array inside a JSON document. */
export function findTablePath(value: Json): string[] | undefined {
  if (Array.isArray(value)) return [];
  if (!isRecord(value)) return undefined;
  let best: { path: string[]; size: number } | undefined;
  const visit = (node: Json, path: string[], depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(node)) {
      const objects = node.filter(isRecord).length;
      if (objects && (!best || objects > best.size)) best = { path, size: objects };
      return;
    }
    if (isRecord(node))
      for (const [k, v] of Object.entries(node)) visit(v, [...path, k], depth + 1);
  };
  visit(value, [], 0);
  return best?.path;
}

export function getPath(value: Json, path: string[]): Json {
  let current: Json = value;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = Object.hasOwn(current, segment) ? current[segment] : null;
  }
  return current;
}

export function rowsToTable(items: Json[]): Table {
  const rows: Row[] = items.map((item) =>
    isRecord(item) ? item : { value: item },
  );
  return { columns: columnsOf(rows), rows };
}

export function decode(
  text: string,
  format: Format,
  options: { tablePath?: string[] } = {},
): Decoded {
  if (format === "csv" || format === "tsv") {
    const { columns, rows } = parseDelimited(text, {
      delimiter: format === "tsv" ? "\t" : ",",
    });
    return {
      table: {
        columns,
        rows: rows.map((cells) =>
          Object.fromEntries(columns.map((c, i) => [c, cells[i]])),
        ),
      },
    };
  }
  if (format === "text") {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    return {
      table: {
        columns: ["line", "number"],
        rows: lines.map((line, i) => ({ line, number: i + 1 })),
      },
    };
  }
  let root: Json;
  const trimmed = text.trim();
  try {
    root = JSON.parse(trimmed) as Json;
  } catch {
    // JSON Lines
    try {
      root = trimmed
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Json);
    } catch {
      throw new CodecError("not valid JSON or JSON Lines");
    }
  }
  const tablePath = options.tablePath ?? findTablePath(root) ?? [];
  const target = getPath(root, tablePath);
  const items = Array.isArray(target) ? target : target === null ? [] : [target];
  return { table: rowsToTable(items), root, tablePath };
}

export function encodeTable(
  table: Table,
  format: Format,
  columns: string[] = table.columns,
): string {
  if (format === "csv" || format === "tsv")
    return encodeDelimited(
      columns,
      table.rows.map((r) => columns.map((c) => (Object.hasOwn(r, c) ? r[c] : null))),
      { delimiter: format === "tsv" ? "\t" : "," },
    );
  if (format === "text")
    return table.rows
      .map((r) => {
        const v = r[columns[0]];
        return v === null || v === undefined
          ? ""
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      })
      .map((l) => l + "\n")
      .join("");
  return JSON.stringify(
    table.rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))),
    null,
    2,
  );
}
