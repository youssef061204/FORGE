import type { JsonSchema } from "./contracts";
import { schemaType } from "../contracts/json-schema";
import { IRCompileError, type ForgeIR, type IRExpr } from "./schema";
import type { IRAnalysis } from "./typecheck";

type Helper = { source: string; dependencies?: string[] };
// These are compiler-owned, context-free data primitives. Only helpers selected
// by a lowered node are included in its ordinary executable source.
const HELPERS: Record<string, Helper> = {
  tick: {
    source: `let _work = 0; const _tick = (): void => { if (++_work > 50000) throw new Error("IR work budget exceeded"); };`,
  },
  array: {
    source: `const _array = (v: unknown): unknown[] => { if (!Array.isArray(v) || v.length > 1000) throw new Error("IR collection budget/type"); return v; };`,
  },
  object: {
    source: `const _object = (v: unknown): Record<string, unknown> => { if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("IR object type"); return v as Record<string, unknown>; };`,
  },
  string: {
    source: `const _string = (v: unknown): string => { if (typeof v !== "string") throw new Error("IR string type"); return v; };`,
  },
  bool: {
    source: `const _bool = (v: unknown): boolean => { if (typeof v !== "boolean") throw new Error("IR boolean type"); return v; };`,
  },
  numeric: {
    source: `const _numeric = (v: unknown): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("IR finite number type"); return v; };`,
  },
  finite: {
    source: `const _finite = (v: number): number => { if (!Number.isFinite(v)) throw new Error("IR non-finite arithmetic"); return v; };`,
  },
  integer: {
    dependencies: ["numeric"],
    source: `const _integer = (v: unknown): number => { const n = _numeric(v); if (!Number.isInteger(n)) throw new Error("IR integer type"); return n; };`,
  },
  checked: {
    source: `const _checked = (v: string): string => { if (v.length > 32768) throw new Error("IR intermediate string budget"); return v; };`,
  },
  number: {
    dependencies: ["numeric", "string", "finite"],
    source: String.raw`const _number = (v: unknown): number => { if (typeof v === "number") return _numeric(v); const s = _string(v).trim(); if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) throw new Error("IR invalid decimal"); return _finite(Number(s)); };`,
  },
  scalar: {
    source: `const _scalar = (v: unknown): string | number | boolean | null => { if (v !== null && !["string", "number", "boolean"].includes(typeof v)) throw new Error("IR scalar type"); return v as string | number | boolean | null; };`,
  },
  safeKey: {
    source: `const _safeKey = (s: string): string => { if (["__proto__", "prototype", "constructor"].includes(s)) throw new Error("IR unsafe field"); return s; };`,
  },
  get: {
    source: `const _get = (base: unknown, path: Array<string | number>): unknown => { let v = base; for (const k of path) { if (v === null) return null; if (Array.isArray(v)) { if (typeof k !== "number") throw new Error("IR array index"); v = Object.hasOwn(v, k) ? v[k] : null; } else if (typeof v === "object" && v !== null) { if (typeof k !== "string") throw new Error("IR object field"); v = Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : null; } else throw new Error("IR path on scalar"); } return v; };`,
  },
  key: {
    source: `const _key = (v: unknown): string => { if (Array.isArray(v)) return "[" + v.map(_key).join(",") + "]"; if (v !== null && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + _key((v as Record<string, unknown>)[k])).join(",") + "}"; const s = JSON.stringify(v); if (s === undefined) throw new Error("IR non-JSON value"); return s; };`,
  },
  compare: {
    dependencies: ["string", "numeric"],
    source: `const _compare = (a: unknown, b: unknown): number => { if (typeof a === "number" && typeof b === "number") { _numeric(a); _numeric(b); return a < b ? -1 : a > b ? 1 : 0; } const x = _string(a), y = _string(b); return x < y ? -1 : x > y ? 1 : 0; };`,
  },
  divide: {
    dependencies: ["numeric", "finite"],
    source: `const _divide = (a: unknown, b: unknown, modulo: boolean): number => { const x = _numeric(a), y = _numeric(b); if (y === 0) throw new Error("IR zero divisor"); return _finite(modulo ? x % y : x / y); };`,
  },
  sum: {
    dependencies: ["array", "numeric", "finite"],
    source: `const _sum = (v: unknown): number => _array(v).reduce<number>((a, b) => _finite(a + _numeric(b)), 0);`,
  },
  extrema: {
    dependencies: ["array", "numeric"],
    source: `const _extrema = (values: unknown[], minimum: boolean): number | null => { const a = values.length === 1 && Array.isArray(values[0]) ? _array(values[0]) : values; if (!a.length) return null; const numbers = a.map(_numeric); return minimum ? Math.min(...numbers) : Math.max(...numbers); };`,
  },
  includes: {
    dependencies: ["array", "string", "key"],
    source: `const _includes = (a: unknown, b: unknown): boolean => typeof a === "string" ? a.includes(_string(b)) : _array(a).some(v => _key(v) === _key(b));`,
  },
  slice: {
    dependencies: ["array", "integer"],
    source: `const _slice = (v: unknown, start: unknown, end?: unknown): unknown => { const a = _integer(start), b = end === undefined ? undefined : _integer(end); return typeof v === "string" ? v.slice(a, b) : _array(v).slice(a, b); };`,
  },
  iso: {
    dependencies: ["string"],
    source: String.raw`const _iso = (v: unknown): Date => { const s = _string(v); const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(s); if (!m) throw new Error("IR ISO format"); const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]); const c=new Date(0); c.setUTCFullYear(y,mo-1,d); c.setUTCHours(0,0,0,0); if(c.getUTCFullYear()!==y || c.getUTCMonth()+1!==mo || c.getUTCDate()!==d || (m[4]!==undefined && (Number(m[4])>23 || Number(m[5])>59 || Number(m[6])>59)) || (m[8] && m[8]!=="Z" && (Number(m[8].slice(1,3))>23 || Number(m[8].slice(4))>59))) throw new Error("IR invalid date"); const result=m[4]===undefined?c:new Date(s); if(!Number.isFinite(result.getTime()) || !/^\d{4}-/.test(result.toISOString())) throw new Error("IR date range"); return result; };`,
  },
  dateAdd: {
    dependencies: ["iso", "integer"],
    source: String.raw`const _dateAdd = (v: unknown, days: unknown): string => { const d=_iso(v); d.setUTCDate(d.getUTCDate()+_integer(days)); if(!Number.isFinite(d.getTime()) || !/^\d{4}-/.test(d.toISOString())) throw new Error("IR date range"); return d.toISOString().slice(0,10); };`,
  },
  filter: {
    dependencies: ["tick", "bool"],
    source: `const _filter = (a: unknown[], p: (v: unknown) => unknown): unknown[] => a.filter(v => { _tick(); return _bool(p(v)); });`,
  },
  project: {
    dependencies: ["tick"],
    source: `const _project = (a: unknown[], p: (v: unknown) => unknown): unknown[] => a.map(v => { _tick(); return p(v); });`,
  },
  flatMap: {
    dependencies: ["tick", "array"],
    source: `const _flatMap = (a: unknown[], p: (v: unknown) => unknown): unknown[] => { const out: unknown[]=[]; for(const v of a) { _tick(); out.push(..._array(p(v))); _array(out); } return out; };`,
  },
  join: {
    dependencies: ["tick", "array", "bool"],
    source: `const _join = (a: unknown[], b: unknown[], p: (a: unknown,b: unknown) => unknown, outer: boolean): unknown[] => { const out:unknown[]=[]; for(const left of a) { let found=false; for(const right of b) { _tick(); if(_bool(p(left,right))) { out.push({left,right}); found=true; _array(out); } } if(outer&&!found) {out.push({left,right:null});_array(out);} } return out; };`,
  },
  distinct: {
    dependencies: ["tick", "key"],
    source: `const _distinct = (a: unknown[], key: (v: unknown) => unknown, last: boolean): unknown[] => { const keys=a.map(v=>{_tick();return _key(key(v));}); const positions=new Map<string,number>(); keys.forEach((k,i)=>{if(last||!positions.has(k))positions.set(k,i);}); return a.filter((_,i)=>positions.get(keys[i])===i); };`,
  },
  sort: {
    dependencies: ["tick", "compare"],
    source: `const _sort = (a: unknown[], keys: (v: unknown) => unknown[], desc: boolean[], first: boolean[]): unknown[] => { const decorated=a.map((row,position)=>{_tick();return {row,position,values:keys(row)};}); decorated.sort((a,b)=>{_tick();for(let i=0;i<desc.length;i++){const x=a.values[i],y=b.values[i];const n=x===null||y===null?(x===y?0:x===null?(first[i]?-1:1):(first[i]?1:-1)):_compare(x,y)*(desc[i]?-1:1);if(n)return n;}return a.position-b.position;});return decorated.map(v=>v.row); };`,
  },
  record: {
    dependencies: ["tick", "string", "safeKey"],
    source: `const _record = (a:unknown[], key:(v:unknown)=>unknown, value:(v:unknown)=>unknown, policy:string):Record<string,unknown> => { const out:Record<string,unknown>=Object.create(null);for(const row of a){_tick();const name=_safeKey(_string(key(row)));if(Object.hasOwn(out,name)){if(policy==="first")continue;if(policy!=="last")throw new Error("IR duplicate record key");}out[name]=value(row);}return out; };`,
  },
  aggregate: {
    dependencies: ["array", "numeric", "sum", "finite"],
    source: `const _aggregate = (op:string, a:unknown[]):unknown => {if(op==="count")return a.length;if(op==="collect")return _array(a);if(op==="first")return a[0]??null;if(op==="last")return a.at(-1)??null;if(op==="sum"||op==="mean"){const n=_sum(a);return op==="sum"?n:a.length?_finite(n/a.length):null;}const values=a.map(_numeric);return !values.length?null:op==="min"?Math.min(...values):Math.max(...values);};`,
  },
  group: {
    dependencies: ["tick", "array", "key", "scalar", "aggregate"],
    source: `const _group=(a:unknown[],key:(v:unknown)=>Record<string,unknown>,aggregates:Array<{name:string;op:string;value?:(v:unknown)=>unknown}>):unknown[]=>{const groups=new Map<string,{keys:Record<string,unknown>;rows:unknown[]}>();for(const row of a){_tick();const keys=key(row);Object.values(keys).forEach(_scalar);const id=_key(keys);const g=groups.get(id)??{keys,rows:[]};g.rows.push(row);groups.set(id,g);}const out:unknown[]=[];for(const g of groups.values()){const row:Record<string,unknown>={...g.keys};for(const spec of aggregates){const values=spec.op==="count"?g.rows:g.rows.map(v=>{_tick();return spec.value!(v);});row[spec.name]=_aggregate(spec.op,values);}out.push(row);}return _array(out);};`,
  },
  valid: {
    dependencies: ["key"],
    source: `const _valid = (raw: unknown, v: unknown): boolean => { if(typeof raw==="boolean")return raw; const s=raw as Record<string,unknown>; const type=s.type; const types=Array.isArray(type)?type:[type]; if(type!==undefined&&!types.some(t=>t==="null"?v===null:t==="array"?Array.isArray(v):t==="object"?v!==null&&typeof v==="object"&&!Array.isArray(v):t==="integer"?typeof v==="number"&&Number.isInteger(v):t==="number"?typeof v==="number"&&Number.isFinite(v):typeof v===t))return false; if(Object.hasOwn(s,"const")&&_key(v)!==_key(s.const))return false;if(Array.isArray(s.enum)&&!s.enum.some(x=>_key(x)===_key(v)))return false;for(const name of ["anyOf","oneOf","allOf"]){const list=s[name];if(Array.isArray(list)){const n=list.filter(x=>_valid(x,v)).length;if(name==="anyOf"&&!n||name==="oneOf"&&n!==1||name==="allOf"&&n!==list.length)return false;}}if(s.not!==undefined&&_valid(s.not,v))return false;if(typeof v==="number"){if(typeof s.minimum==="number"&&v<s.minimum||typeof s.maximum==="number"&&v>s.maximum||typeof s.exclusiveMinimum==="number"&&v<=s.exclusiveMinimum||typeof s.exclusiveMaximum==="number"&&v>=s.exclusiveMaximum||typeof s.multipleOf==="number"&&!Number.isInteger(v/s.multipleOf))return false;}if(typeof v==="string"){const n=[...v].length;if(typeof s.minLength==="number"&&n<s.minLength||typeof s.maxLength==="number"&&n>s.maxLength)return false;}if(Array.isArray(v)){if(typeof s.minItems==="number"&&v.length<s.minItems||typeof s.maxItems==="number"&&v.length>s.maxItems||s.uniqueItems===true&&new Set(v.map(_key)).size!==v.length)return false;if(s.items!==undefined&&!v.every(x=>_valid(s.items,x)))return false;}else if(v!==null&&typeof v==="object"){const obj=v as Record<string,unknown>;const props=(s.properties??{}) as Record<string,unknown>;if(Array.isArray(s.required)&&s.required.some(k=>typeof k!=="string"||!Object.hasOwn(obj,k)))return false;for(const k of Object.keys(obj)){if(Object.hasOwn(props,k)){if(!_valid(props[k],obj[k]))return false;}else if(s.additionalProperties===false||typeof s.additionalProperties==="object"&&!_valid(s.additionalProperties,obj[k]))return false;}}return true;};`,
  },
  newline: {
    dependencies: ["checked"],
    source: String.raw`const _newline=(s:string,enabled:boolean):string=>_checked(enabled&&s&&!s.endsWith("\n")?s+"\n":s);`,
  },
  encodeJson: {
    dependencies: ["valid", "newline"],
    source: `const _encodeJson=(v:unknown,schema:unknown,newline:boolean):string=>{if(!_valid(schema,v))throw new Error("IR encoding schema mismatch");return _newline(JSON.stringify(v),newline);};`,
  },
  encodeText: {
    dependencies: ["valid", "newline", "array", "string"],
    source: String.raw`const _encodeText=(v:unknown,schema:unknown,newline:boolean):string=>{if(!_valid(schema,v))throw new Error("IR encoding schema mismatch");return _newline(typeof v==="string"?v:_array(v).map(_string).join("\n"),newline);};`,
  },
  encodeCsv: {
    dependencies: [
      "valid",
      "newline",
      "array",
      "string",
      "object",
      "scalar",
      "safeKey",
      "tick",
    ],
    source: String.raw`const _encodeCsv=(v:unknown,schema:unknown,columns:unknown,newline:boolean):string=>{if(!_valid(schema,v))throw new Error("IR encoding schema mismatch");const names=_array(columns).map(_string);if(!names.length||names.length>20||new Set(names).size!==names.length||names.some(n=>!n.trim()||n.length>80))throw new Error("IR CSV columns");names.forEach(_safeKey);const cell=(v:unknown):string=>{const x=_scalar(v),s=x===null?"":String(x);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};const lines=[names.map(cell).join(",")];for(const item of _array(v)){_tick();const row=_object(item);lines.push(names.map(n=>{if(!Object.hasOwn(row,n))throw new Error("IR missing CSV cell");return cell(row[n]);}).join(","));}return _newline(lines.join("\n"),newline);};`,
  },
  finish: {
    source: `const _finish=(out:ModuleOutput):ModuleOutput=>{const text=JSON.stringify(out);let bytes=0;for(const c of text){const n=c.codePointAt(0)!;bytes+=n<=127?1:n<=2047?2:n<=65535?3:4;}if(bytes>8192)throw new Error("IR output byte budget");return out;};`,
  },
};

export type IRSourceLocation = { offset: number; line: number; column: number };
export type IREmission = {
  source: string;
  sourceMap: Record<string, IRSourceLocation>;
  helpers: string[];
};
function typeSource(schema: JsonSchema): string {
  return schema.type === "array" && schema.maxItems === 0
    ? "never[]"
    : schemaType(schema);
}

export function emitIR(ir: ForgeIR, analysis: IRAnalysis): IREmission {
  const used = new Set<string>();
  const markers: { marker: string; path: string }[] = [];
  let counter = 0;
  function helper(name: string): string {
    if (!used.has(name)) {
      for (const dependency of HELPERS[name].dependencies ?? [])
        helper(dependency);
      used.add(name);
    }
    return "_" + name;
  }
  const fresh = () => `_v${counter++}`;
  const roots = new Map<string, string>([
    ["input", "input"],
    ["observations", "input.observations"],
    ["params", "input.input"],
    ["state", "input.state"],
    ["now", "input.now"],
  ]);
  const cast = (source: string, expr: IRExpr) =>
    `(${source} as ${typeSource(analysis.schemas.get(expr)!)})`;
  function callback(
    name: string,
    body: IRExpr,
    scope: Map<string, string>,
    path: string,
  ) {
    const parameter = fresh();
    return `(${parameter}:unknown)=>${expression(body, new Map([...scope, [name, parameter]]), path)}`;
  }
  function expression(
    expr: IRExpr,
    scope: Map<string, string>,
    path: string,
  ): string {
    helper("tick");
    const marker = `/*@${markers.length}*/`;
    markers.push({ marker, path });
    let value: string;
    const child = (item: IRExpr, name: string) =>
      expression(item, scope, `${path}/${name}`);
    switch (expr.kind) {
      case "literal":
        value = JSON.stringify(expr.value);
        break;
      case "get":
        value = cast(
          `${helper("get")}(${scope.get(expr.root)!},${JSON.stringify(expr.path)})`,
          expr,
        );
        break;
      case "object":
        value = `({${Object.entries(expr.fields)
          .map(
            ([key, item]) =>
              `[${JSON.stringify(key)}]:${child(item, `fields/${key}`)}`,
          )
          .join(",")}})`;
        break;
      case "array":
        value = `[${expr.items.map((item, index) => child(item, `items/${index}`)).join(",")}]`;
        break;
      case "scalar": {
        const args = expr.args.map((item, index) =>
          child(item, `args/${index}`),
        );
        const call = (name: string, items = args) =>
          `${helper(name)}(${items.join(",")})`;
        const numeric = (index: number) =>
          `${helper("numeric")}(${args[index]})`;
        const string = (index: number) => `${helper("string")}(${args[index]})`;
        switch (expr.op) {
          case "number":
            value = call("number");
            break;
          case "string":
            value = `String(${call("scalar")})`;
            break;
          case "trim":
            value = `${string(0)}.trim()`;
            break;
          case "lower":
            value = `${string(0)}.toLowerCase()`;
            break;
          case "upper":
            value = `${string(0)}.toUpperCase()`;
            break;
          case "split":
            value = `${helper("array")}(${string(0)}.split(${string(1)})) as string[]`;
            break;
          case "join":
            value = `${helper("checked")}(${helper("array")}(${args[0]}).map(${helper("string")}).join(${string(1)}))`;
            break;
          case "concat":
            value = `${helper("checked")}([${args.join(",")}].map(${helper("string")}).join(""))`;
            break;
          case "length": {
            const v = fresh();
            value = `((${v}:unknown)=>typeof ${v}==="string"?${v}.length:${helper("array")}(${v}).length)(${args[0]})`;
            break;
          }
          case "add":
          case "subtract":
          case "multiply":
            value = `${helper("finite")}(${numeric(0)}${expr.op === "add" ? "+" : expr.op === "subtract" ? "-" : "*"}${numeric(1)})`;
            break;
          case "divide":
          case "modulo":
            value = call("divide", [...args, String(expr.op === "modulo")]);
            break;
          case "round":
          case "floor":
          case "abs":
            value = `Math.${expr.op}(${numeric(0)})`;
            break;
          case "sum":
            value = call("sum");
            break;
          case "min":
          case "max":
            value = call("extrema", [
              `[${args.join(",")}]`,
              String(expr.op === "min"),
            ]);
            break;
          case "eq":
          case "ne":
            value = `(${helper("key")}(${args[0]})${expr.op === "eq" ? "===" : "!=="}${helper("key")}(${args[1]}))`;
            break;
          case "lt":
          case "lte":
          case "gt":
          case "gte":
            value = `(${call("compare")}${({ lt: "<", lte: "<=", gt: ">", gte: ">=" } as const)[expr.op]}0)`;
            break;
          case "and":
          case "or":
            value = `(${args.map((arg) => `${helper("bool")}(${arg})`).join(expr.op === "and" ? "&&" : "||")})`;
            break;
          case "not":
            value = `!${call("bool")}`;
            break;
          case "if":
            value = `(${helper("bool")}(${args[0]})?${args[1]}:${args[2]})`;
            break;
          case "coalesce":
            value = `(${args.join("??")})`;
            break;
          case "isNull":
            value = `(${args[0]}===null)`;
            break;
          case "includes":
            value = call("includes");
            break;
          case "startsWith":
          case "endsWith":
            value = `${string(0)}.${expr.op}(${string(1)})`;
            break;
          case "slice":
            value = cast(call("slice"), expr);
            break;
          case "replace":
            value = `${helper("checked")}(${string(0)}.split(${string(1)}).join(${string(2)}))`;
            break;
          case "isoDate":
            value = `${call("iso")}.toISOString().slice(0,10)`;
            break;
          case "dateAddDays":
            value = call("dateAdd");
            break;
          case "keys":
            value = `Object.keys(${call("object")})`;
            break;
          case "values":
            value = cast(
              `${helper("array")}(Object.values(${call("object")}))`,
              expr,
            );
            break;
          case "entries":
            value = cast(
              `${helper("array")}(Object.entries(${call("object")}).map(([key,value])=>({key,value})))`,
              expr,
            );
            break;
        }
        break;
      }
      case "query": {
        const declarations: string[] = [];
        let current = fresh();
        declarations.push(
          `const ${current}=${helper("array")}(${child(expr.source, "source")});`,
        );
        for (const [index, step] of expr.steps.entries()) {
          const at = `${path}/steps/${index}`;
          let next: string;
          switch (step.op) {
            case "filter":
              next = `${helper("filter")}(${current},${callback(step.as, step.where, scope, `${at}/where`)})`;
              break;
            case "project":
              next = `${helper("project")}(${current},${callback(step.as, step.value, scope, `${at}/value`)})`;
              break;
            case "flatMap":
              next = `${helper("flatMap")}(${current},${callback(step.as, step.value, scope, `${at}/value`)})`;
              break;
            case "join": {
              const left = fresh(),
                right = fresh(),
                inner = new Map([
                  ...scope,
                  [step.leftAs, left],
                  [step.rightAs, right],
                ]);
              next = `${helper("join")}(${current},${helper("array")}(${expression(step.right, scope, `${at}/right`)}),(${left}:unknown,${right}:unknown)=>${expression(step.on, inner, `${at}/on`)},${step.mode === "left"})`;
              break;
            }
            case "group": {
              const parameter = fresh(),
                inner = new Map([...scope, [step.as, parameter]]);
              const keys = `(${parameter}:unknown)=>({${Object.entries(
                step.keys,
              )
                .map(
                  ([key, item]) =>
                    `[${JSON.stringify(key)}]:${expression(item, inner, `${at}/keys/${key}`)}`,
                )
                .join(",")}})`;
              const aggregates = Object.entries(step.aggregates).map(
                ([name, aggregate]) =>
                  `{name:${JSON.stringify(name)},op:${JSON.stringify(aggregate.op)}${aggregate.op === "count" ? "" : `,value:${callback(step.as, aggregate.value, scope, `${at}/aggregates/${name}/value`)}`}}`,
              );
              next = `${helper("group")}(${current},${keys},[${aggregates.join(",")}])`;
              break;
            }
            case "distinct":
              next = `${helper("distinct")}(${current},${step.by ? callback(step.as, step.by, scope, `${at}/by`) : "(v:unknown)=>v"},${step.keep === "last"})`;
              break;
            case "sort": {
              const parameter = fresh(),
                inner = new Map([...scope, [step.as, parameter]]);
              next = `${helper("sort")}(${current},(${parameter}:unknown)=>[${step.by.map((order, key) => expression(order.value, inner, `${at}/by/${key}/value`)).join(",")}],${JSON.stringify(step.by.map((order) => order.direction === "desc"))},${JSON.stringify(step.by.map((order) => order.nulls === "first"))})`;
              break;
            }
            case "slice":
              next = `${current}.slice(${step.offset},${step.offset + step.limit})`;
              break;
            case "record":
              next = `${helper("record")}(${current},${callback(step.as, step.key, scope, `${at}/key`)},${callback(step.as, step.value, scope, `${at}/value`)},${JSON.stringify(step.duplicates ?? "error")})`;
              break;
          }
          const name = fresh();
          declarations.push(`const ${name}=${next};`);
          current = name;
        }
        value = cast(
          `(()=>{${declarations.join("")}return ${current};})()`,
          expr,
        );
        break;
      }
      case "encode":
        if (expr.schema === undefined)
          throw new IRCompileError([
            {
              stage: "emit",
              code: "ENCODE_SCHEMA_UNRESOLVED",
              path,
              message: "Encoding schema inference must precede emission",
            },
          ]);
        value = `${helper(expr.format === "csv" ? "encodeCsv" : expr.format === "json" ? "encodeJson" : "encodeText")}(${child(expr.value, "value")},${JSON.stringify(expr.schema)},${expr.format === "csv" ? `${child(expr.columns!, "columns")},` : ""}${expr.terminalNewline === true})`;
        break;
    }
    return `(${marker}_tick(),${value})`;
  }
  const lines: string[] = [];
  for (const [index, binding] of ir.bindings.entries()) {
    const name = fresh();
    lines.push(
      `const ${name}:${typeSource(analysis.schemas.get(binding.value)!)}=${expression(binding.value, roots, `/bindings/${index}/value`)};`,
    );
    roots.set(binding.id, name);
  }
  for (const [index, effect] of ir.effects.entries()) {
    const scope = new Map(roots);
    let open = "",
      close = "";
    if (effect.forEach) {
      const name = fresh();
      open = `for(const ${name} of ${helper("array")}(${expression(effect.forEach.source, roots, `/effects/${index}/forEach/source`)})){`;
      close = "}";
      scope.set(effect.forEach.item, name);
    }
    const condition = effect.when
      ? `${helper("bool")}(${expression(effect.when, scope, `/effects/${index}/when`)})`
      : "true";
    lines.push(
      `${open}_tick();if(${condition}){if(operations.length>=20)throw new Error("IR effect budget exceeded");operations.push({operation:${JSON.stringify(effect.operation)},arguments:${expression(effect.arguments, scope, `/effects/${index}/arguments`)}});}${close}`,
    );
  }
  const summary = expression(ir.result.summary, roots, "/result/summary");
  const details = ir.result.details
    ? expression(ir.result.details, roots, "/result/details")
    : "[]";
  const state = ir.state ? expression(ir.state, roots, "/state") : "{}";
  helper("finish");
  const source = `function execute(input: ModuleInput): ModuleOutput {\n${[...used].map((name) => HELPERS[name].source).join("\n")}\nconst operations:ModuleOutput["operations"]=[];\n${lines.join("\n")}\nreturn _finish({operations,result:{summary:${summary},details:${details}},state:${state}});\n}`;
  const sourceMap = Object.fromEntries(
    markers.map(({ marker, path }) => {
      const offset = source.indexOf(marker);
      const before = source.slice(0, offset);
      const line = before.split("\n").length;
      const column = offset - before.lastIndexOf("\n");
      return [path, { offset, line, column }];
    }),
  );
  return { source, sourceMap, helpers: [...used] };
}
