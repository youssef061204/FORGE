/**
 * The recipe expression language: short strings such as
 *   num(quantity) * num(price)
 *   lower(trim(email))
 *   status != 'done' and date >= '2026-10-10'
 * Parsed into a small AST with source positions. Total by construction: there
 * are no loops, assignments, lambdas or user-defined functions.
 */
import type { Json } from "../table";

export type Span = { s: number; e: number };
export type BinOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "in";
export type Expr =
  | ({ k: "lit"; v: Json } & Span)
  | ({ k: "col"; path: string[] } & Span)
  | ({ k: "list"; items: Expr[] } & Span)
  | ({ k: "call"; fn: string; args: Expr[] } & Span)
  | ({ k: "neg"; arg: Expr } & Span)
  | ({ k: "not"; arg: Expr } & Span)
  | ({ k: "bin"; op: BinOp; l: Expr; r: Expr } & Span);

export class ExprError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly at: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ExprError";
  }
  /** "num(quantty) * price" with a caret under the problem. */
  pointer(): string {
    return `${this.source}\n${" ".repeat(Math.max(0, this.at))}^`;
  }
}

export const EXPR_LIMITS = { chars: 600, depth: 24, nodes: 200 };

type Tok =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "str"; v: string; s: number; e: number }
  | { t: "id"; v: string; s: number; e: number }
  | { t: "op"; v: string; s: number; e: number }
  | { t: "eof"; s: number; e: number };

const KEYWORDS = new Set(["and", "or", "not", "in", "true", "false", "null"]);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const s = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      out.push({ t: "num", v: Number(m[0]), s, e: i });
      continue;
    }
    if (c === "'" || c === '"') {
      let v = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new ExprError("text is missing its closing quote", src, s);
        const ch = src[i];
        if (ch === "\\") {
          const nx = src[i + 1];
          // Only quotes, backslash, \n and \t are escapes; anything else keeps
          // its backslash so regex classes like '\d' survive.
          v += nx === "n" ? "\n" : nx === "t" ? "\t" : nx === "\\" || nx === "'" || nx === '"' ? nx : "\\" + (nx ?? "");
          i += 2;
          continue;
        }
        if (ch === c) {
          if (src[i + 1] === c) {
            v += c;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += ch;
        i++;
      }
      out.push({ t: "str", v, s, e: i });
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end < 0) throw new ExprError("column name is missing its closing `", src, s);
      out.push({ t: "id", v: src.slice(i + 1, end), s, e: end + 1 });
      i = end + 1;
      continue;
    }
    // Regex-style references to a named group, ?<task> or \task, can only mean
    // the column that group became, so read them as that column.
    const groupRef = /^(?:\?<([A-Za-z_][A-Za-z0-9_]*)>|\\([A-Za-z_][A-Za-z0-9_]*))/.exec(src.slice(i));
    if (groupRef) {
      i += groupRef[0].length;
      out.push({ t: "id", v: groupRef[1] ?? groupRef[2], s, e: i });
      continue;
    }
    if (/[A-Za-z_\u00c0-\uffff]/.test(c)) {
      const m = /^[A-Za-z_\u00c0-\uffff][A-Za-z0-9_\u00c0-\uffff]*/.exec(src.slice(i))!;
      i += m[0].length;
      out.push({ t: "id", v: m[0], s, e: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "<>", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two, s, e: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/%<>=(),.[]!".includes(c)) {
      out.push({ t: "op", v: c, s, e: i + 1 });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character "${c}"`, src, i, c === "\\" || c === "?" || c === "$" || c === "@" ? "refer to a column by its plain name, e.g. task (no backslash, ? or <>)" : c === "{" || c === "}" ? "an expression is one value; build objects with separate columns instead" : undefined);
  }
  out.push({ t: "eof", s: src.length, e: src.length });
  return out;
}

const BINARY: Record<string, { op: BinOp; bp: number }> = {
  or: { op: "or", bp: 1 },
  "||": { op: "or", bp: 1 },
  and: { op: "and", bp: 2 },
  "&&": { op: "and", bp: 2 },
  "==": { op: "==", bp: 4 },
  "=": { op: "==", bp: 4 },
  "!=": { op: "!=", bp: 4 },
  "<>": { op: "!=", bp: 4 },
  "<": { op: "<", bp: 4 },
  "<=": { op: "<=", bp: 4 },
  ">": { op: ">", bp: 4 },
  ">=": { op: ">=", bp: 4 },
  in: { op: "in", bp: 4 },
  "+": { op: "+", bp: 5 },
  "-": { op: "-", bp: 5 },
  "*": { op: "*", bp: 6 },
  "/": { op: "/", bp: 6 },
  "%": { op: "%", bp: 6 },
};

export function parseExpr(src: string): Expr {
  if (typeof src !== "string") throw new ExprError("expected an expression string", String(src), 0);
  if (src.length > EXPR_LIMITS.chars)
    throw new ExprError(`expressions are limited to ${EXPR_LIMITS.chars} characters`, src, 0);
  if (!src.trim()) throw new ExprError("expression is empty", src, 0);
  const toks = lex(src);
  let p = 0;
  let nodes = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const node = <T extends Expr>(n: T): T => {
    if (++nodes > EXPR_LIMITS.nodes)
      throw new ExprError("expression is too large", src, n.s);
    return n;
  };
  const expectOp = (v: string, what: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new ExprError(`expected ${what}`, src, t.s);
    return t;
  };
  const opOf = (t: Tok): string | undefined =>
    t.t === "op" ? t.v : t.t === "id" && (t.v === "and" || t.v === "or" || t.v === "in") ? t.v : undefined;

  function expr(minBp: number, depth: number): Expr {
    if (depth > EXPR_LIMITS.depth) throw new ExprError("expression nests too deeply", src, peek().s);
    let left = prefix(depth);
    for (;;) {
      const t = peek();
      // "not in"
      if (t.t === "id" && t.v === "not" && (toks[p + 1] as { v?: string })?.v === "in" && toks[p + 1].t === "id" && minBp <= 4) {
        p += 2;
        const right = expr(5, depth + 1);
        left = node({ k: "not", arg: node({ k: "bin", op: "in", l: left, r: right, s: left.s, e: right.e }), s: left.s, e: right.e });
        continue;
      }
      // "is null" / "is not null"
      if (t.t === "id" && t.v.toLowerCase() === "is" && minBp <= 4) {
        p++;
        let negate = false;
        if (peek().t === "id" && (peek() as { v: string }).v === "not") {
          negate = true;
          p++;
        }
        const n = next();
        if (n.t !== "id" || n.v !== "null") throw new ExprError('expected "null" after "is"', src, n.s);
        const call = node({ k: "call", fn: "is_null", args: [left], s: left.s, e: n.e } as Expr);
        left = negate ? node({ k: "not", arg: call, s: left.s, e: n.e }) : call;
        continue;
      }
      const op = opOf(t);
      if (!op || !BINARY[op]) break;
      const { op: bin, bp } = BINARY[op];
      if (bp < minBp) break;
      p++;
      const right = expr(bp + 1, depth + 1);
      left = node({ k: "bin", op: bin, l: left, r: right, s: left.s, e: right.e });
    }
    return left;
  }

  function prefix(depth: number): Expr {
    const t = next();
    if (t.t === "num") return node({ k: "lit", v: t.v, s: t.s, e: t.e });
    if (t.t === "str") return node({ k: "lit", v: t.v, s: t.s, e: t.e });
    if (t.t === "op" && t.v === "-") {
      const arg = expr(7, depth + 1);
      if (arg.k === "lit" && typeof arg.v === "number")
        return node({ k: "lit", v: -arg.v, s: t.s, e: arg.e });
      return node({ k: "neg", arg, s: t.s, e: arg.e });
    }
    if (t.t === "op" && t.v === "+") return expr(7, depth + 1);
    if (t.t === "op" && t.v === "!") {
      const arg = expr(3, depth + 1);
      return node({ k: "not", arg, s: t.s, e: arg.e });
    }
    if (t.t === "op" && t.v === "(") {
      const inner = expr(0, depth + 1);
      expectOp(")", 'a closing ")"');
      return inner;
    }
    if (t.t === "op" && t.v === "[") {
      const items: Expr[] = [];
      if (!(peek().t === "op" && (peek() as { v: string }).v === "]")) {
        do items.push(expr(0, depth + 1));
        while (peek().t === "op" && (peek() as { v: string }).v === "," && next());
      }
      const end = expectOp("]", 'a closing "]"');
      return node({ k: "list", items, s: t.s, e: end.e });
    }
    if (t.t === "id") {
      const quoted = src[t.s] === "`";
      if (!quoted && t.v === "not") {
        const arg = expr(3, depth + 1);
        return node({ k: "not", arg, s: t.s, e: arg.e });
      }
      if (!quoted && (t.v === "true" || t.v === "false"))
        return node({ k: "lit", v: t.v === "true", s: t.s, e: t.e });
      if (!quoted && t.v === "null") return node({ k: "lit", v: null, s: t.s, e: t.e });
      if (!quoted && t.v === "TRUE") return node({ k: "lit", v: true, s: t.s, e: t.e });
      if (!quoted && t.v === "FALSE") return node({ k: "lit", v: false, s: t.s, e: t.e });
      if (!quoted && peek().t === "op" && (peek() as { v: string }).v === "(") {
        p++;
        const args: Expr[] = [];
        if (!(peek().t === "op" && (peek() as { v: string }).v === ")")) {
          do args.push(expr(0, depth + 1));
          while (peek().t === "op" && (peek() as { v: string }).v === "," && next());
        }
        const end = expectOp(")", `a closing ")" for ${t.v}(`);
        return node({ k: "call", fn: t.v.toLowerCase(), args, s: t.s, e: end.e });
      }
      if (!quoted && KEYWORDS.has(t.v))
        throw new ExprError(`"${t.v}" needs something before it`, src, t.s);
      const path = [t.v];
      let e = t.e;
      while (peek().t === "op" && (peek() as { v: string }).v === "." && toks[p + 1]?.t === "id") {
        p++;
        const seg = next() as { v: string; e: number };
        path.push(seg.v);
        e = seg.e;
      }
      return node({ k: "col", path, s: t.s, e });
    }
    if (t.t === "eof") throw new ExprError("expression ended early", src, t.s);
    throw new ExprError(`unexpected "${(t as { v: string }).v}"`, src, t.s);
  }

  const result = expr(0, 0);
  const rest = peek();
  if (rest.t !== "eof") {
    const v = (rest as { v: string }).v;
    throw new ExprError(
      `unexpected "${v}" after a complete expression`,
      src,
      rest.s,
      v === "=" ? "compare with == " : undefined,
    );
  }
  return result;
}

const PREC: Record<BinOp, number> = {
  or: 1,
  and: 2,
  "==": 4,
  "!=": 4,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  in: 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

export function quoteText(v: string): string {
  return "'" + v.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\t", "\\t") + "'";
}

export function isPlainName(name: string): boolean {
  return /^[A-Za-z_\u00c0-\uffff][A-Za-z0-9_\u00c0-\uffff]*$/.test(name) && !KEYWORDS.has(name) && name !== "is" && name !== "TRUE" && name !== "FALSE";
}

export function printName(name: string): string {
  return isPlainName(name) ? name : "`" + name + "`";
}

/** Canonical source text. parseExpr(printExpr(e)) is structurally equal to e. */
export function printExpr(e: Expr, parentBp = 0): string {
  switch (e.k) {
    case "lit":
      if (typeof e.v === "string") return quoteText(e.v);
      if (typeof e.v === "number") {
        const text = Number.isInteger(e.v) || Math.abs(e.v) >= 1e-6 ? String(e.v) : e.v.toExponential();
        return e.v < 0 && parentBp > 0 ? `(${text})` : text;
      }
      return JSON.stringify(e.v);
    case "col":
      return e.path.map(printName).join(".");
    case "list":
      return "[" + e.items.map((i) => printExpr(i)).join(", ") + "]";
    case "call":
      return e.fn + "(" + e.args.map((a) => printExpr(a)).join(", ") + ")";
    case "neg": {
      const inner = printExpr(e.arg, 7);
      return "-" + (inner.startsWith("-") ? `(${inner})` : inner);
    }
    case "not": {
      const text = "not " + printExpr(e.arg, 3);
      return parentBp > 3 ? `(${text})` : text;
    }
    case "bin": {
      const bp = PREC[e.op];
      const text = `${printExpr(e.l, bp)} ${e.op} ${printExpr(e.r, bp + 1)}`;
      return bp < parentBp ? `(${text})` : text;
    }
  }
}

/** Structural equality ignoring spans. */
export function sameExpr(a: Expr, b: Expr): boolean {
  const strip = (x: Expr): unknown => {
    switch (x.k) {
      case "lit":
        return ["lit", x.v];
      case "col":
        return ["col", x.path];
      case "list":
        return ["list", x.items.map(strip)];
      case "call":
        return ["call", x.fn, x.args.map(strip)];
      case "neg":
        return ["neg", strip(x.arg)];
      case "not":
        return ["not", strip(x.arg)];
      case "bin":
        return ["bin", x.op, strip(x.l), strip(x.r)];
    }
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export function walkExpr(e: Expr, visit: (e: Expr) => void) {
  visit(e);
  if (e.k === "list") e.items.forEach((i) => walkExpr(i, visit));
  else if (e.k === "call") e.args.forEach((a) => walkExpr(a, visit));
  else if (e.k === "neg" || e.k === "not") walkExpr(e.arg, visit);
  else if (e.k === "bin") {
    walkExpr(e.l, visit);
    walkExpr(e.r, visit);
  }
}
