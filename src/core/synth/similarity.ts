/** Local text similarity (word TF-IDF + character trigrams). No model, no network. */

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-￿]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

const STOP = new Set(
  "the a an and or of to in on for with as by from is are be it its this that each every all save file csv json txt into one per only keep then their his her my me i we you your".split(
    " ",
  ),
);

export function trigrams(text: string): Set<string> {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export class Retriever<T> {
  private docs: { item: T; tf: Map<string, number>; tri: Set<string> }[] = [];
  private df = new Map<string, number>();
  constructor(items: T[], text: (item: T) => string) {
    for (const item of items) {
      const tf = new Map<string, number>();
      const s = text(item);
      for (const w of words(s)) tf.set(w, (tf.get(w) ?? 0) + 1);
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      this.docs.push({ item, tf, tri: trigrams(s) });
    }
  }
  private idf(w: string) {
    return Math.log((1 + this.docs.length) / (1 + (this.df.get(w) ?? 0))) + 1;
  }
  score(query: string): { item: T; score: number }[] {
    const q = new Map<string, number>();
    for (const w of words(query)) q.set(w, (q.get(w) ?? 0) + 1);
    const qt = trigrams(query);
    const qn = Math.sqrt([...q].reduce((s, [w, c]) => s + (c * this.idf(w)) ** 2, 0)) || 1;
    return this.docs
      .map((d) => {
        let dot = 0;
        let dn = 0;
        for (const [w, c] of d.tf) {
          const x = c * this.idf(w);
          dn += x * x;
          if (q.has(w)) dot += x * q.get(w)! * this.idf(w);
        }
        const cos = dot / (qn * (Math.sqrt(dn) || 1));
        return { item: d.item, score: 0.7 * cos + 0.3 * jaccard(qt, d.tri) };
      })
      .sort((a, b) => b.score - a.score);
  }
  top(query: string, k: number): T[] {
    return this.score(query)
      .slice(0, k)
      .map((s) => s.item);
  }
}
