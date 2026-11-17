import type { Program } from "./contracts";
import ts from "typescript";

// Character trigrams tolerate inflection/spelling differences; word TF-IDF and
// connector metadata supply a separate lexical signal. This is a local hybrid
// retriever, not a claimed neural embedding or measured routing improvement.
function features(text: string) {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  const result = new Map<string, number>();
  for (const word of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const key = "w:" + word;
    result.set(key, (result.get(key) ?? 0) + 2);
    if (word.length > 3)
      for (let i = 0; i <= word.length - 3; i++) {
        const tri = "c:" + word.slice(i, i + 3);
        result.set(tri, (result.get(tri) ?? 0) + 0.25);
      }
  }
  return result;
}
export function retrievePrograms(goal: string, programs: Program[], limit = 3) {
  const candidates = programs.filter(
    (p) =>
      ![
        "review",
        "rejected",
        "blocked",
        "superseded",
        "revoked",
        "paused",
      ].includes(p.status),
  );
  const documents = candidates.map((p) =>
    features(
      [
        p.name,
        p.description,
        p.goal,
        ...p.connectors,
        ...p.actions,
        ...p.reads.map((read) => read.operation),
        ...p.permissions,
        p.trigger.kind,
        ...(p.postconditions ?? [])
          .filter((condition) => condition.kind === "artifact")
          .flatMap((condition) => [condition.name, condition.format]),
      ].join(" "),
    ),
  );
  const query = features(goal);
  const df = new Map<string, number>();
  for (const doc of documents)
    for (const feature of doc.keys())
      df.set(feature, (df.get(feature) ?? 0) + 1);
  function vector(raw: Map<string, number>) {
    return new Map(
      [...raw].map(([key, value]) => [
        key,
        Math.log1p(value) *
          (Math.log((documents.length + 1) / ((df.get(key) ?? 0) + 1)) + 1),
      ]),
    );
  }
  const q = vector(query);
  const qnorm = Math.sqrt([...q.values()].reduce((s, v) => s + v * v, 0));
  return candidates
    .map((program, index) => {
      const vectorDoc = vector(documents[index]);
      let dot = 0,
        norm = 0;
      for (const [key, value] of vectorDoc) {
        dot += value * (q.get(key) ?? 0);
        norm += value * value;
      }
      return { program, score: dot / (Math.sqrt(norm) * qnorm || 1) };
    })
    .sort(
      (a, b) => b.score - a.score || a.program.id.localeCompare(b.program.id),
    )
    .slice(0, limit);
}
export function programComplexity(source: string) {
  const tree = ts.createSourceFile(
    "program.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  let astNodes = 0,
    branches = 0;
  function visit(node: ts.Node) {
    astNodes++;
    if (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCaseClause(node) ||
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node)
    )
      branches++;
    node.forEachChild(visit);
  }
  visit(tree);
  return {
    loc: source.split(/\r?\n/).filter((line) => line.trim()).length,
    characters: source.length,
    astNodes,
    branches,
  };
}
