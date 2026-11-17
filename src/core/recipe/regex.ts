/**
 * A linear-time regular expression engine (Thompson NFA, Pike VM).
 *
 * Recipes may only use this engine. Backreferences and lookaround are not
 * part of the language, so every match runs in O(pattern × input) time and a
 * pattern such as (a+)+$ cannot stall a tool. Supported syntax:
 *   literals, ., \d \D \w \W \s \S \b \B, escapes, [classes], [^negated],
 *   ^ $, (groups), (?:non-capturing), (?<name>named), |, * + ? {n} {n,} {n,m}
 *   and their lazy forms, plus a leading (?i) for case-insensitive matching.
 */

export class RegexError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (at character ${position + 1})`);
    this.name = "RegexError";
  }
}

export const REGEX_LIMITS = { patternChars: 500, program: 4000, repeat: 100 };

type Node =
  | { t: "char"; test: (c: string) => boolean }
  | { t: "start" }
  | { t: "end" }
  | { t: "word"; negate: boolean }
  | { t: "group"; index: number | null; body: Node }
  | { t: "cat"; items: Node[] }
  | { t: "alt"; items: Node[] }
  | { t: "rep"; body: Node; min: number; max: number; greedy: boolean };

type Inst =
  | { op: "char"; test: (c: string) => boolean }
  | { op: "match" }
  | { op: "jmp"; x: number }
  | { op: "split"; x: number; y: number }
  | { op: "save"; n: number }
  | { op: "start" }
  | { op: "end" }
  | { op: "word"; negate: boolean };

const isDigit = (c: string) => c >= "0" && c <= "9";
const isWord = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || isDigit(c) || c === "_";
const isSpace = (c: string) => /\s/.test(c);

class Parser {
  i = 0;
  groups = 0;
  names: (string | null)[] = [];
  constructor(
    readonly src: string,
    readonly fold: boolean,
  ) {}
  fail(message: string): never {
    throw new RegexError(message, this.i);
  }
  peek() {
    return this.src[this.i];
  }
  eat(c: string) {
    if (this.src[this.i] === c) {
      this.i++;
      return true;
    }
    return false;
  }
  literal(ch: string): (c: string) => boolean {
    if (!this.fold) return (c) => c === ch;
    const lo = ch.toLowerCase();
    return (c) => c.toLowerCase() === lo;
  }
  parse(): Node {
    const node = this.alt();
    if (this.i < this.src.length) this.fail(`unexpected "${this.peek()}"`);
    return node;
  }
  alt(): Node {
    const items = [this.cat()];
    while (this.eat("|")) items.push(this.cat());
    return items.length === 1 ? items[0] : { t: "alt", items };
  }
  cat(): Node {
    const items: Node[] = [];
    while (this.i < this.src.length && this.peek() !== "|" && this.peek() !== ")")
      items.push(this.repeat());
    return { t: "cat", items };
  }
  repeat(): Node {
    const start = this.i;
    let body = this.atom();
    for (;;) {
      let min: number, max: number;
      const c = this.peek();
      if (c === "*") [min, max] = [0, Infinity];
      else if (c === "+") [min, max] = [1, Infinity];
      else if (c === "?") [min, max] = [0, 1];
      else if (c === "{" && /^\{\d+(,\d*)?\}/.test(this.src.slice(this.i))) {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i))!;
        min = Number(m[1]);
        max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
        if (max < min) this.fail("repeat range is backwards");
        if (min > REGEX_LIMITS.repeat || (max !== Infinity && max > REGEX_LIMITS.repeat))
          this.fail(`repeat counts above ${REGEX_LIMITS.repeat} are not allowed`);
        this.i += m[0].length - 1;
      } else return body;
      this.i++;
      const greedy = !this.eat("?");
      if (body.t === "start" || body.t === "end" || body.t === "word")
        throw new RegexError("an anchor cannot be repeated", start);
      body = { t: "rep", body, min, max, greedy };
    }
  }
  atom(): Node {
    const c = this.peek();
    if (c === undefined) this.fail("pattern ended early");
    if (c === "(") {
      this.i++;
      let index: number | null = null;
      if (this.eat("?")) {
        if (this.eat(":")) index = null;
        else if (this.eat("<")) {
          const m = /^([A-Za-z_][A-Za-z0-9_]{0,31})>/.exec(this.src.slice(this.i));
          if (!m) this.fail("expected a group name like (?<name>...)");
          this.i += m[0].length;
          index = ++this.groups;
          this.names[index] = m[1];
        } else if (this.peek() === "=" || this.peek() === "!")
          this.fail("lookahead is not supported; it can make matching slow");
        else this.fail("unsupported group syntax");
      } else {
        index = ++this.groups;
        this.names[index] = null;
      }
      const body = this.alt();
      if (!this.eat(")")) this.fail('missing ")"');
      return { t: "group", index, body };
    }
    if (c === ")") this.fail('unmatched ")"');
    if (c === "*" || c === "+" || c === "?") this.fail("nothing to repeat");
    this.i++;
    if (c === "^") return { t: "start" };
    if (c === "$") return { t: "end" };
    if (c === ".") return { t: "char", test: (x) => x !== "\n" && x !== "\r" };
    if (c === "[") return { t: "char", test: this.klass() };
    if (c === "\\") return this.escape(false) as Node;
    return { t: "char", test: this.literal(c) };
  }
  escape(inClass: boolean): Node | ((c: string) => boolean) {
    const c = this.src[this.i++];
    if (c === undefined) this.fail("pattern ends with a backslash");
    const wrap = (test: (c: string) => boolean): Node | ((c: string) => boolean) =>
      inClass ? test : { t: "char", test };
    switch (c) {
      case "d":
        return wrap(isDigit);
      case "D":
        return wrap((x) => !isDigit(x));
      case "w":
        return wrap(isWord);
      case "W":
        return wrap((x) => !isWord(x));
      case "s":
        return wrap(isSpace);
      case "S":
        return wrap((x) => !isSpace(x));
      case "t":
        return wrap((x) => x === "\t");
      case "n":
        return wrap((x) => x === "\n");
      case "r":
        return wrap((x) => x === "\r");
      case "b":
      case "B":
        if (inClass) this.fail("\\b is not allowed inside a class");
        return { t: "word", negate: c === "B" };
    }
    if (/[1-9]/.test(c)) this.fail("backreferences are not supported");
    if (/[A-Za-z0-9]/.test(c)) this.fail(`unknown escape \\${c}`);
    return wrap(this.literal(c));
  }
  klass(): (c: string) => boolean {
    const negate = this.eat("^");
    const tests: ((c: string) => boolean)[] = [];
    let first = true;
    while (this.peek() !== "]" || first) {
      first = false;
      const c = this.src[this.i];
      if (c === undefined) this.fail('missing "]"');
      this.i++;
      let lo: string;
      if (c === "\\") {
        const t = this.escape(true) as (c: string) => boolean;
        const prev = this.src[this.i - 1];
        if (/[dDwWsS]/.test(prev)) {
          tests.push(t);
          continue;
        }
        lo = { t: "\t", n: "\n", r: "\r" }[prev] ?? prev;
      } else lo = c;
      if (this.peek() === "-" && this.src[this.i + 1] !== "]" && this.src[this.i + 1] !== undefined) {
        this.i++;
        let hi = this.src[this.i++];
        if (hi === "\\") hi = this.src[this.i++];
        if (hi < lo) this.fail("class range is backwards");
        const [a, b] = [lo, hi];
        if (this.fold)
          tests.push((x) => {
            const l = x.toLowerCase(),
              u = x.toUpperCase();
            return (l >= a && l <= b) || (u >= a && u <= b);
          });
        else tests.push((x) => x >= a && x <= b);
      } else tests.push(this.literal(lo));
    }
    this.i++;
    return negate ? (x) => !tests.some((t) => t(x)) : (x) => tests.some((t) => t(x));
  }
}

function compile(node: Node, prog: Inst[]) {
  const emit = (inst: Inst) => {
    if (prog.length >= REGEX_LIMITS.program)
      throw new RegexError("pattern expands beyond the size limit", 0);
    prog.push(inst);
    return prog.length - 1;
  };
  const walk = (n: Node) => {
    switch (n.t) {
      case "char":
        emit({ op: "char", test: n.test });
        return;
      case "start":
        emit({ op: "start" });
        return;
      case "end":
        emit({ op: "end" });
        return;
      case "word":
        emit({ op: "word", negate: n.negate });
        return;
      case "group":
        if (n.index !== null) emit({ op: "save", n: n.index * 2 });
        walk(n.body);
        if (n.index !== null) emit({ op: "save", n: n.index * 2 + 1 });
        return;
      case "cat":
        n.items.forEach(walk);
        return;
      case "alt": {
        const jumps: number[] = [];
        for (let k = 0; k < n.items.length; k++) {
          if (k < n.items.length - 1) {
            const split = emit({ op: "split", x: 0, y: 0 });
            (prog[split] as { x: number }).x = prog.length;
            walk(n.items[k]);
            jumps.push(emit({ op: "jmp", x: 0 }));
            (prog[split] as { y: number }).y = prog.length;
          } else walk(n.items[k]);
        }
        for (const j of jumps) (prog[j] as { x: number }).x = prog.length;
        return;
      }
      case "rep": {
        for (let k = 0; k < n.min; k++) walk(n.body);
        if (n.max === Infinity) {
          const split = emit({ op: "split", x: 0, y: 0 });
          const bodyStart = prog.length;
          walk(n.body);
          emit({ op: "jmp", x: split });
          const after = prog.length;
          prog[split] = n.greedy
            ? { op: "split", x: bodyStart, y: after }
            : { op: "split", x: after, y: bodyStart };
        } else {
          const splits: number[] = [];
          for (let k = n.min; k < n.max; k++) {
            splits.push(emit({ op: "split", x: 0, y: 0 }));
            walk(n.body);
          }
          const after = prog.length;
          splits.forEach((s, k) => {
            const body = s + 1;
            const skip = after;
            void k;
            prog[s] = n.greedy
              ? { op: "split", x: body, y: skip }
              : { op: "split", x: skip, y: body };
          });
        }
        return;
      }
    }
  };
  walk(node);
}

export type RegexMatch = {
  index: number;
  end: number;
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
};

export class SafeRegex {
  private prog: Inst[] = [];
  readonly groupCount: number;
  readonly groupNames: (string | null)[];
  constructor(readonly source: string) {
    if (source.length > REGEX_LIMITS.patternChars)
      throw new RegexError(`patterns are limited to ${REGEX_LIMITS.patternChars} characters`, 0);
    let body = source;
    let fold = false;
    if (body.startsWith("(?i)")) {
      fold = true;
      body = body.slice(4);
    }
    const parser = new Parser(body, fold);
    const ast = parser.parse();
    this.groupCount = parser.groups;
    this.groupNames = parser.names;
    this.prog.push({ op: "save", n: 0 });
    compile(ast, this.prog);
    this.prog.push({ op: "save", n: 1 });
    this.prog.push({ op: "match" });
  }

  test(input: string): boolean {
    return this.exec(input) !== null;
  }

  exec(input: string): RegexMatch | null {
    const prog = this.prog;
    const slots = (this.groupCount + 1) * 2;
    type Thread = { pc: number; caps: Int32Array };
    let clist: Thread[] = [];
    let nlist: Thread[] = [];
    const mark = new Int32Array(prog.length).fill(-1);
    let generation = 0;
    let matched: Int32Array | null = null;
    const n = input.length;

    const add = (list: Thread[], pc: number, caps: Int32Array, pos: number) => {
      // Iterative DFS preserving priority order.
      const stack: { pc: number; caps: Int32Array }[] = [{ pc, caps }];
      while (stack.length) {
        const { pc: p, caps: c } = stack.pop()!;
        if (mark[p] === generation) continue;
        mark[p] = generation;
        const inst = prog[p];
        switch (inst.op) {
          case "jmp":
            stack.push({ pc: inst.x, caps: c });
            break;
          case "split":
            stack.push({ pc: inst.y, caps: c });
            stack.push({ pc: inst.x, caps: c });
            break;
          case "save": {
            const copy = c.slice();
            copy[inst.n] = pos;
            stack.push({ pc: p + 1, caps: copy });
            break;
          }
          case "start":
            if (pos === 0) stack.push({ pc: p + 1, caps: c });
            break;
          case "end":
            if (pos === n) stack.push({ pc: p + 1, caps: c });
            break;
          case "word": {
            const before = pos > 0 && isWord(input[pos - 1]);
            const after = pos < n && isWord(input[pos]);
            if ((before !== after) !== inst.negate) stack.push({ pc: p + 1, caps: c });
            break;
          }
          default:
            list.push({ pc: p, caps: c });
        }
      }
    };

    for (let pos = 0; pos <= n; pos++) {
      if (!matched) {
        generation++;
        // A new attempt starting here has the lowest priority.
        const existing = clist;
        clist = [];
        for (const t of existing) mark[t.pc] = generation;
        clist.push(...existing);
        const fresh: Thread[] = [];
        add(fresh, 0, new Int32Array(slots).fill(-1), pos);
        clist.push(...fresh);
      }
      // No live threads: stop only once a match is found; otherwise a fresh
      // attempt starts at the next position (an anchor may fail here only).
      if (!clist.length) {
        if (matched) break;
        continue;
      }
      generation++;
      nlist = [];
      const ch = input[pos];
      for (const t of clist) {
        const inst = prog[t.pc];
        if (inst.op === "match") {
          matched = t.caps;
          break; // lower-priority threads are cut off
        }
        if (inst.op === "char" && pos < n && inst.test(ch)) add(nlist, t.pc + 1, t.caps, pos + 1);
      }
      clist = nlist;
    }
    if (!matched) {
      // Threads that reached match at end of input.
      for (const t of clist)
        if (prog[t.pc].op === "match") {
          matched = t.caps;
          break;
        }
    }
    if (!matched) return null;
    const groups: (string | undefined)[] = [];
    for (let g = 0; g <= this.groupCount; g++) {
      const a = matched[g * 2],
        b = matched[g * 2 + 1];
      groups.push(a >= 0 && b >= 0 ? input.slice(a, b) : undefined);
    }
    const named: Record<string, string | undefined> = {};
    this.groupNames.forEach((name, g) => {
      if (name) named[name] = groups[g];
    });
    return { index: matched[0], end: matched[1], groups, named };
  }

  replaceAll(input: string, replacement: string): string {
    let out = "";
    let pos = 0;
    let guard = 0;
    while (pos <= input.length && guard++ <= input.length + 1) {
      const m = this.exec(input.slice(pos));
      if (!m) break;
      out += input.slice(pos, pos + m.index) + replacement;
      const advance = m.end === m.index ? 1 : m.end;
      if (m.end === m.index) out += input.slice(pos + m.index, pos + m.index + 1);
      pos += advance;
    }
    return out + input.slice(pos);
  }
}

const cache = new Map<string, SafeRegex>();
export function safeRegex(pattern: string): SafeRegex {
  let re = cache.get(pattern);
  if (!re) {
    re = new SafeRegex(pattern);
    if (cache.size > 256) cache.clear();
    cache.set(pattern, re);
  }
  return re;
}
