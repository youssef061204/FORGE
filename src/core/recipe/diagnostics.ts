export type Diagnostic = {
  code: string;
  /** JSON-pointer-ish location, e.g. steps[1].set.total */
  where: string;
  step?: number;
  message: string;
  hint?: string;
  /** The expression text and the character offset of the problem. */
  expr?: string;
  at?: number;
  /** A fix the host can apply without guessing. */
  fix?: { kind: "group-by"; step: number; column: string };
};

export class RecipeError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map(formatDiagnostic).slice(0, 3).join("; "));
    this.name = "RecipeError";
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const head = d.step !== undefined ? `step ${d.step + 1}` : d.where;
  return `${head}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`;
}

export function distance(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[n];
}

export function didYouMean(name: string, options: string[]): string | undefined {
  const lower = name.toLowerCase();
  const exact = options.find((o) => o.toLowerCase() === lower);
  if (exact) return exact;
  let best: string | undefined;
  let score = Infinity;
  for (const o of options) {
    const d = distance(lower, o.toLowerCase());
    if (d < score) {
      score = d;
      best = o;
    }
  }
  const limit = name.length <= 4 ? 1 : 2;
  return score <= limit ? best : undefined;
}
