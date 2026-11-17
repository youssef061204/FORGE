# Recipes

A recipe is the program FORGE builds. It is small JSON: named inputs, a flat
list of steps, and outputs. Steps carry short expression strings. The language
has no loops, no recursion, no user-defined functions and no way to name a
file, a socket or a process, so a recipe **cannot loop forever, reach the
network, or read anything you didn't hand it**. That is a property of the
language, not a promise of a sandbox.

```json
{
  "inputs": [{ "slot": "orders", "format": "csv" }],
  "steps": [
    { "op": "derive", "set": { "total": "num(quantity) * num(price)" } },
    { "op": "summarize", "by": ["item"], "set": { "total": "sum(total)" } }
  ],
  "outputs": [
    { "kind": "file", "name": "totals.json", "format": "json", "shape": { "map": { "key": "item", "value": "total" } } },
    { "kind": "view", "type": "bar", "x": "item", "y": "total" }
  ]
}
```

FORGE renders it, from the syntax tree and never from a model, as:
*1. Read orders (CSV). 2. Add a column "total" = quantity × price. 3. Group by
"item" and compute "total" = the total of total. 4. Save totals.json as item →
total. 5. Show a bar chart of total by item.*

Implementation: `src/core/recipe/` (schema, expression parser and printer,
evaluator, English, regex engine). It runs unchanged in Node, a browser Web
Worker and tests.

## Inputs

| field | meaning |
| --- | --- |
| `slot` | the input's name inside the recipe, e.g. `orders` |
| `format` | `csv`, `tsv`, `json` or `text`; inferred from the file when omitted |
| `path` | for JSON, the dotted path to the array of rows (`products`); found automatically when omitted |

CSV and TSV cells stay **text**, so `9.50` survives a round trip. A text file is
a table with columns `line` and `number`. JSON rows keep their types and nested
objects; reach into them with dotted paths (`pricing.price`).

## Steps

Each step reads the previous step's table, or the table named in `from`, and
may name its own result with `as` for later steps.

| op | fields | does |
| --- | --- | --- |
| `filter` | `where` | keep rows where the expression is true (null and false drop) |
| `derive` | `set: {col: expr}` | add or replace columns, in order; later entries see earlier ones |
| `select` | `columns` | keep these columns, in this order |
| `drop` | `columns` | remove columns |
| `rename` | `map: {old: new}` | rename columns, keeping order |
| `sort` | `by: ["expr", "expr desc"]` | stable sort; nulls last in both directions |
| `dedupe` | `by`, `keep: first\|last` | remove repeated rows (whole row when `by` is omitted) |
| `summarize` | `by`, `set: {col: aggregate}` | one row per group, in first-seen order; no `by` gives one row |
| `join` | `with`, `on`, `kind` | hash join; `inner`, `left`, `anti` (no match), `semi` (has match) |
| `unnest` | `column`, `into` | one row per item of a list column |
| `lines` | `column`, `into` | one row per line of a text column |
| `match` | `column`, `pattern`, `keep` | regex; named groups `(?<name>…)` become columns; `keep: "all"` keeps non-matching rows with nulls |
| `limit` | `n`, `offset` | slice |
| `union` | `with` | stack another table's rows underneath |

Join keys compare as text (`1` and `"1"` match); nulls never match. Right-hand
columns that collide with left ones are named `<table>.<column>`.

## Outputs

`{"kind": "file", "name", "format", "columns"?, "shape"?, "from"?}`

| JSON `shape` | writes |
| --- | --- |
| omitted / `"rows"` | a list of row objects |
| `"row"` | one object (the table must have exactly one row) |
| `{"map": {"key", "value"}}` | an object of key → value; duplicate keys are an error |
| `{"values": "col"}` | a list of one column's values |

A `text` file writes one value per line; give `shape: {"values": "col"}` or a
single column. CSV and TSV quote cells containing the delimiter, quotes,
newlines or surrounding spaces, and always keep the header. Visible numbers
drop binary noise (31.2, not 31.199999999999996).

`{"kind": "view", "type": "bar" | "line" | "table" | "stat", "x", "y", "title"}`
draws on the tool's dashboard.

## Expressions

Column names (`amount`, `` `odd name` ``, `pricing.price`, `orders.amount`),
literals (`'text'`, `"text"`, `12.5`, `true`, `false`, `null`), lists
(`['open', 'pending']`), and:

| | |
| --- | --- |
| arithmetic | `+ - * / %` read numeric text as numbers; division by zero gives null |
| comparison | `== != < <= > >=`; `=` and `<>` are accepted; with a number on one side, text is read as a number |
| logic | `and or not`, also `&& \|\| !` |
| membership | `x in [...]`, `x not in [...]`, `x is null`, `x is not null` |

Text comparisons are by code point, which also orders ISO dates. **Sorting a
text column is by code point**, so sort amounts with `num(amount)`; FORGE flags
a sort over numbers stored as text and asks for a repair.

`num()` accepts `12`, ` 12.5 `, `$1,200`, `-3`, `12%` (→ 12); empty text is
null; anything else is an error, never a silent zero.

### Functions

`num text bool` · `lower upper trim title len` · `contains icontains starts_with
ends_with` · `replace(s, a, b)` `regex_replace(s, re, b)` · `left right slice
split split_part join concat` · `coalesce if is_null is_empty is_number` ·
`round(x, digits) floor ceil abs sqrt least greatest` · `date year month day
month_key weekday days_between add_days today` · `matches(s, re) extract(s, re,
group)`

Common spellings are accepted as aliases (`lowercase`, `substr`, `iif`,
`ifelse`, `avg`, `n_distinct`, `datediff`, …). `today()` reads the run's clock.

### Aggregates

`count() count(x) count_distinct(x) sum mean median min max first last list`.
Inside `summarize` they summarize each group. Inside `derive`, `filter` or
`sort` they mean the **whole table**: `votes * 100 / sum(votes)`,
`num(salary) > mean(num(salary))`. `min(a, b)` with two arguments compares
values; `min(x)` is the aggregate.

## Regular expressions

Patterns run on FORGE's own engine (`core/recipe/regex.ts`, a Pike VM), so
matching is linear in pattern × input and `(a+)+$` cannot stall a tool.
Supported: literals, `.`, `\d \D \w \W \s \S \b \B`, classes, anchors, groups,
named groups, alternation, `* + ? {n} {n,} {n,m}` and lazy forms, `(?i)`.
Lookaround and backreferences are rejected with a located error. Repeat
counts are capped at 100 and compiled programs at 4,000 instructions.

## Limits

Inputs up to 10 MB and 100,000 rows by default; a run is bounded by a work
budget of 20 million row-steps, 200,000 output rows, 5 seconds of wall clock
and 512 MB of heap in the worker sandbox. Grouping and hash-joining 100,000
rows takes well under a second (tested).

## Accepted slips

Small models make unambiguous slips. FORGE accepts them rather than rejecting
a correct idea: `?<name>` or `\name` for a named group's column, a bare
`count` for `count()`, `select ["a.b as c"]`, op aliases such as `group_by`,
`mutate`, `order_by`, and a few envelope variants (`{"column", "expr"}` for
`set`). Anything ambiguous is rejected with a diagnostic that drives repair.

## How recipes are checked

1. The envelope is parsed (Zod) and expressions parsed with locations.
2. The compiler checks every column, function, arity, aggregate placement and
   pattern against the real profiled schema, with did-you-mean hints.
3. The recipe runs on the real data and host-made variants; properties are
   checked (see `docs/ARCHITECTURE.md`).
4. The recipe is emitted as plain TypeScript, compiled with `tsc`, and run
   against the interpreter on every test input; outputs must match byte for
   byte (`src/server/verify.ts`). The same file is what "eject" downloads.
5. Approval binds to `sha256(canonical recipe + language version)`.
