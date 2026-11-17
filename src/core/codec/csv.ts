/**
 * RFC 4180 CSV/TSV parsing and encoding. Isomorphic: no Node or DOM APIs.
 *
 * Cells stay text. Type conversion is explicit in recipes (num(), date()), so
 * a tool that reads "9.50" and writes it back preserves "9.50".
 */

export type CsvOptions = { delimiter?: "," | "\t" | ";" };

export class CodecError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = "CodecError";
  }
}

/** Parse delimited text into a header and string rows. Linear time. */
export function parseDelimited(
  text: string,
  options: CsvOptions = {},
): { columns: string[]; rows: string[][] } {
  const delimiter = options.delimiter ?? ",";
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let i = 0;
  const n = source.length;
  let fieldStart = true;
  while (i < n) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      i++;
      continue;
    }
    if (ch === delimiter) {
      record.push(cell);
      cell = "";
      fieldStart = true;
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      fieldStart = true;
      if (ch === "\r" && source[i + 1] === "\n") i++;
      i++;
      line++;
      continue;
    }
    cell += ch;
    fieldStart = false;
    i++;
  }
  if (quoted) throw new CodecError("unterminated quoted cell", line);
  if (cell !== "" || record.length) {
    record.push(cell);
    records.push(record);
  }
  // Blank lines carry no data.
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
  if (!nonEmpty.length) return { columns: [], rows: [] };
  const columns = nonEmpty[0].map((c) => c.trim());
  const seen = new Set<string>();
  columns.forEach((c, index) => {
    if (!c) throw new CodecError(`column ${index + 1} has an empty header`, 1);
    if (seen.has(c)) throw new CodecError(`duplicate column "${c}"`, 1);
    seen.add(c);
  });
  const rows = nonEmpty.slice(1);
  rows.forEach((r, index) => {
    if (r.length !== columns.length)
      throw new CodecError(
        `expected ${columns.length} cells, found ${r.length}`,
        index + 2,
      );
  });
  return { columns, rows };
}

function needsQuote(value: string, delimiter: string) {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    /^\s|\s$/.test(value)
  );
}

export function encodeCell(value: unknown, delimiter = ","): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return needsQuote(text, delimiter) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function encodeDelimited(
  columns: string[],
  rows: unknown[][],
  options: CsvOptions = {},
): string {
  const d = options.delimiter ?? ",";
  const lines = [columns.map((c) => encodeCell(c, d)).join(d)];
  for (const row of rows) lines.push(row.map((v) => encodeCell(v, d)).join(d));
  return lines.join("\n") + "\n";
}
