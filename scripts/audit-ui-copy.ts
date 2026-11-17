import ts from "typescript";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const translations: [RegExp, string][] = [
  [/\bGoalContract\b/g, "Mission"],
  [/\bCapabilities\b/g, "Tools"],
  [/\bCapability\b/g, "Program"],
  [/\bcapabilities\b/g, "tools"],
  [/\bcapability\b/g, "program"],
  [/\bChaos Tournament\b/gi, "Stress Test"],
  [/\bAction Ablation\b/gi, "What mattered"],
  [/\bEvidence Passport\b/gi, "Evidence"],
  [/\bUncertainty Lens\b/gi, "Confidence"],
  [/\bReality Replay\b/g, "Replay"],
  [/\bArtifact\b/g, "Program"],
  [/\bartifact\b/g, "program"],
  [/\bCandidate\b/g, "Option"],
  [/\bcandidate\b/g, "option"],
  [/\bCandidates\b/g, "Options"],
  [/\bcandidates\b/g, "options"],
  [/\bcapability admission\b/gi, "approval"],
  [/\bauthority revoked\b/gi, "Access removed"],
];
const files = await readdir("src/components");
const edits: { path: string; line: number; before: string; after: string }[] =
  [];
for (const file of files.filter((f) => f.endsWith(".tsx"))) {
  const path = join("src/components", file),
    original = await readFile(path, "utf8");
  const source = ts.createSourceFile(
    path,
    original,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const replacements: { start: number; end: number; text: string }[] = [];
  function visit(node: ts.Node) {
    const textNode = ts.isJsxText(node);
    const attribute =
      ts.isStringLiteral(node) &&
      ts.isJsxAttribute(node.parent) &&
      ["aria-label", "title", "placeholder"].includes(
        node.parent.name.getText(source),
      );
    if (textNode || attribute) {
      const before = textNode
        ? node.getText(source)
        : (node as ts.StringLiteral).text;
      let after = before;
      for (const [pattern, replacement] of translations)
        after = after.replace(pattern, replacement);
      if (after !== before) {
        const start = node.getStart(source),
          end = node.getEnd();
        replacements.push({
          start,
          end,
          text: textNode ? after : JSON.stringify(after),
        });
        edits.push({
          path: resolve(path),
          line: source.getLineAndCharacterOfPosition(start).line + 1,
          before: before.trim(),
          after: after.trim(),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (process.argv.includes("--write")) {
    let result = original;
    for (const r of replacements.sort((a, b) => b.start - a.start))
      result = result.slice(0, r.start) + r.text + result.slice(r.end);
    if (result !== original) await writeFile(path, result);
  }
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/ui-copy-audit.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      files: files.filter((f) => f.endsWith(".tsx")).length,
      edits,
      scope:
        "Visible JSX text and accessible titles/placeholders; internal program/operation identifiers preserved",
    },
    null,
    2,
  ),
);
console.log(
  "Audited " +
    files.length +
    " component files; " +
    edits.length +
    " visible copy changes",
);
