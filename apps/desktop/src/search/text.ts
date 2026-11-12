/** Text analysis for the search: no accents, no case, light Italian/English stemming, typos. */

/** Lower case, without accents, with simple punctuation turned into spaces. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+\-_/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  (
    "a ad al allo alla ai agli alle anche che chi ci col con come cosa cui da dal dallo dalla dai dagli dalle " +
    "dei del dello della degli delle di dove e ed gli ha hanno ho i il in io la le lo lui lei ma me mi nel nello " +
    "nella nei negli nelle non o per piu qual quale quali quando quanto se si sono su sul sullo sulla sui sugli " +
    "sulle tra fra tu un uno una the of and for to"
  ).split(" "),
);

export const isStopword = (word: string): boolean => STOPWORDS.has(word);

/** The words of a text, normalized; punctuation and spaces separate them. */
export function words(text: string): string[] {
  return normalize(text)
    .split(/[\s/]+/)
    .map((w) => w.replace(/^[.\-_+]+|[.\-_+]+$/g, ""))
    .filter(Boolean);
}

/**
 * A light stem: enough to treat "fattura/fatture", "cliente/clienti", "invoice/invoices" and
 * "installazione/installazioni" as the same word. Short words are left alone.
 */
export function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  let w = word;
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && /(zioni|zione)$/.test(w)) return w.slice(0, -1).replace(/[ei]$/, "");
  if (w.length > 5 && /(he|hi|ie|ii)$/.test(w)) w = w.slice(0, -2);
  if (w.length > 3 && /[aeiou]$/.test(w)) w = w.slice(0, -1);
  return w;
}

/**
 * Edit distance counting a swap of two neighbouring letters as one edit (the usual typo),
 * giving up as soon as it is certain to exceed `limit`.
 */
export function editDistance(a: string, b: string, limit = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prev2[j - 2] ?? 0) + 1);
      }
      row[j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    prev2.length = 0;
    prev2.push(...prev);
    prev = row;
  }
  return prev[b.length] ?? limit + 1;
}

/** How many typos a word of this length may contain and still match. */
export const typoBudget = (length: number): number => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

export type MatchKind = "exact" | "stem" | "prefix" | "fuzzy" | "none";
export const MATCH_SCORE: Record<MatchKind, number> = {
  exact: 1,
  stem: 0.88,
  prefix: 0.72,
  fuzzy: 0.52,
  none: 0,
};

/** How well the query word `q` is found in the word `w` of a text. */
export function matchWord(q: string, w: string): MatchKind {
  if (q === w) return "exact";
  const sq = stem(q);
  const sw = stem(w);
  if (sq === sw && sq.length > 1) return "stem";
  if (q.length >= 2 && (w.startsWith(q) || (sq.length >= 3 && sw.startsWith(sq)))) return "prefix";
  const budget = typoBudget(Math.min(q.length, w.length));
  if (budget > 0 && editDistance(q, w, budget) <= budget) return "fuzzy";
  if (budget > 0 && sq.length >= 4 && editDistance(sq, sw, budget) <= budget) return "fuzzy";
  return "none";
}

/** The best way `q` matches any word of `target`. */
export function bestMatch(q: string, target: string[]): { kind: MatchKind; score: number } {
  let best: MatchKind = "none";
  for (const w of target) {
    const kind = matchWord(q, w);
    if (MATCH_SCORE[kind] > MATCH_SCORE[best]) best = kind;
    if (best === "exact") break;
  }
  return { kind: best, score: MATCH_SCORE[best] };
}
