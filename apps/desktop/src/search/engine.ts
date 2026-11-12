import type { SqlRunner } from "../data/db";
import type { EntityDef, Rec } from "../data/entity";
import type { Registry } from "../data/registry";
import { buildCatalog, type CatalogItem } from "./catalog";
import {
  conceptsInText,
  conceptsOf,
  entitiesOfConcept,
  fuzzyConceptsOf,
  synonymsOf,
  VOCABULARY,
} from "./thesaurus";
import { bestMatch, editDistance, isStopword, normalize, stem, words, MATCH_SCORE } from "./text";

export type ResultKind = "action" | "page" | "record" | "related";

export interface SearchResult {
  id: string;
  kind: ResultKind;
  /** Section of the result list. */
  group: string;
  title: string;
  subtitle?: string | undefined;
  /** Hash path without "#/". */
  to: string;
  score: number;
  entity?: string | undefined;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Other words the search also looked for ("cliente" → "customer", "committente"). */
  alsoLooked: string[];
  /** A corrected spelling, when nothing was found. */
  suggestion: string | null;
}

interface QueryToken {
  norm: string;
  concepts: string[];
  /** Concepts of the closest known word, when this one looks mistyped (pages and actions only). */
  fuzzy: string[];
  /** Names a kind of record ("fatture", "clienti"): ranks that kind higher instead of being looked for in the text. */
  isType: boolean;
  /** "nuovo", "crea": asks for an action. */
  isVerb: boolean;
}

export interface Analysis {
  tokens: QueryToken[];
  /** Words that must be found in the text of a record. */
  content: QueryToken[];
  typeEntities: Set<string>;
  concepts: Set<string>;
  normalized: string;
}

/** Understands a query: its words, what they stand for and which kinds of record it names. */
export function analyze(query: string): Analysis {
  const normalized = normalize(query);
  const tokens: QueryToken[] = [];
  for (const word of words(query)) {
    if (isStopword(word)) continue;
    const concepts = conceptsOf(word);
    tokens.push({
      norm: word,
      concepts,
      fuzzy: concepts.length === 0 ? fuzzyConceptsOf(word) : [],
      isType: concepts.some((c) => entitiesOfConcept(c).length > 0),
      isVerb: concepts.includes("nuovo"),
    });
  }
  const typeEntities = new Set<string>();
  const concepts = new Set<string>();
  for (const token of tokens) {
    for (const c of token.concepts) {
      concepts.add(c);
      if (token.isType) for (const e of entitiesOfConcept(c)) typeEntities.add(e);
    }
  }
  for (const c of conceptsInText(query)) {
    concepts.add(c);
    for (const e of entitiesOfConcept(c)) typeEntities.add(e);
  }
  const content = tokens.filter((t) => !t.isType && !t.isVerb);
  return { tokens, content, typeEntities, concepts, normalized };
}

/** How well a set of query tokens is found in a list of weighted word lists. */
function scoreTokens(
  tokens: QueryToken[],
  fields: { words: string[]; weight: number }[],
): { score: number; exact: number } {
  if (tokens.length === 0) return { score: 0, exact: 0 };
  let total = 0;
  let exact = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      const match = bestMatch(token.norm, field.words);
      best = Math.max(best, match.score * field.weight);
      if (match.kind === "exact" && field.weight >= 1) exact++;
    }
    total += best;
  }
  return { score: total / tokens.length, exact };
}

/* ---------------------------------------------------------------- pages and actions */

export function searchCatalog(items: CatalogItem[], analysis: Analysis, limit = 7): SearchResult[] {
  if (analysis.tokens.length === 0) return [];
  const wantsAction = analysis.tokens.some((t) => t.isVerb);
  const out: SearchResult[] = [];
  for (const item of items) {
    const titleWords = words(item.title);
    const keyWords = words(item.keywords.join(" "));
    const titleConcepts = conceptsInText(item.title);
    const itemConcepts = conceptsInText(`${item.title} ${item.keywords.join(" ")}`);
    let total = 0;
    let top = 0;
    let matched = 0;
    for (const token of analysis.tokens) {
      const inTitle = bestMatch(token.norm, titleWords).score;
      const inKeys = bestMatch(token.norm, keyWords).score * 0.85;
      // a concept named by the title counts more than one that only a keyword mentions
      const byConcept = token.concepts.some((c) => titleConcepts.has(c))
        ? 0.7
        : token.concepts.some((c) => itemConcepts.has(c))
          ? 0.55
          : 0;
      const byTypo = token.fuzzy.some((c) => itemConcepts.has(c)) ? 0.54 : 0;
      const best = Math.max(inTitle, inKeys, byConcept, byTypo);
      if (best > 0) matched++;
      total += best;
      top = Math.max(top, best);
    }
    if (matched === 0) continue;
    // covering all the words counts most, but one strong word is enough to be offered
    let score = (total / analysis.tokens.length) * 0.7 + top * 0.3;
    const phrase = analysis.normalized;
    const title = normalize(item.title);
    if (title === phrase) score += 0.4;
    else if (title.startsWith(phrase)) score += 0.2;
    else if (title.includes(phrase)) score += 0.1;
    if (item.kind === "action") score += wantsAction ? 0.12 : -0.18;
    if (score < 0.42) continue;
    out.push({
      id: item.id,
      kind: item.kind,
      group: item.kind === "action" ? "Azioni" : "Pagine",
      title: item.title,
      subtitle: item.subtitle,
      to: item.to,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------------------------------------------------------------- records */

/** Kinds of record kept out of the search: their rows are only parts of something else. */
const NOT_SEARCHED = new Set(["attachment", "document_line", "journal_line", "company"]);

interface Candidate {
  row: Rec;
  def: EntityDef;
}

function recordFields(def: EntityDef, row: Rec): { words: string[]; weight: number }[] {
  const fields = [{ words: words(def.title(row)), weight: 1 }];
  for (const f of def.fields) {
    if (!f.searchable) continue;
    const value = row[f.name];
    if (value === null || value === undefined || value === "") continue;
    fields.push({ words: words(String(value)), weight: 0.82 });
  }
  return fields;
}

function prefixPatterns(tokens: QueryToken[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    const word = t.norm.replace(/[\\%_]/g, "");
    if (word.length === 0) continue;
    // two letters keep a word with a typo in the middle or at the end within reach
    out.add(word.length >= 4 ? word.slice(0, 2) : word);
    if (word.length >= 5) out.add(word.slice(-3));
  }
  return [...out].slice(0, 6);
}

async function fetchCandidates(
  db: SqlRunner,
  def: EntityDef,
  analysis: Analysis,
  limit: number,
): Promise<Rec[]> {
  const searchable = def.fields.filter((f) => f.searchable);
  if (searchable.length === 0) return [];
  if (analysis.content.length === 0) {
    // the query only names a kind of record ("fatture"): show the latest of that kind
    if (!analysis.typeEntities.has(def.key)) return [];
    return (await db.query(
      `SELECT * FROM ${def.table} WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 4`,
    )) as Rec[];
  }
  const patterns = prefixPatterns(analysis.content);
  if (patterns.length === 0) return [];
  const clauses: string[] = [];
  const params: string[] = [];
  for (const f of searchable) {
    for (const p of patterns) {
      clauses.push(`${f.name} LIKE ? ESCAPE '\\'`);
      params.push(`%${p}%`);
    }
  }
  return (await db.query(
    `SELECT * FROM ${def.table} WHERE deleted_at IS NULL AND (${clauses.join(" OR ")}) ORDER BY updated_at DESC LIMIT ${limit}`,
    params,
  )) as Rec[];
}

function scoreRecord(def: EntityDef, row: Rec, analysis: Analysis): number {
  const fields = recordFields(def, row);
  const typeBoost = analysis.typeEntities.has(def.key) ? 0.2 : 0;
  if (analysis.content.length === 0) return 0.45 + typeBoost;
  const { score, exact } = scoreTokens(analysis.content, fields);
  if (score < 0.42) return 0;
  let total = score + typeBoost;
  const title = normalize(def.title(row));
  if (title === analysis.normalized) total += 0.3;
  else if (title.includes(analysis.normalized)) total += 0.12;
  if (exact >= analysis.content.length) total += 0.1;
  return total;
}

export interface SearchOptions {
  /** Records examined per kind before ranking. */
  scan?: number;
  limits?: { actions: number; pages: number; records: number; related: number };
}

const DEFAULT_LIMITS = { actions: 3, pages: 4, records: 8, related: 5 };

/** The kinds of record that point at `entity`, with the field that does it. */
function referrers(registry: Registry, entity: string): { def: EntityDef; field: string }[] {
  const out: { def: EntityDef; field: string }[] = [];
  for (const def of registry.entities) {
    if (NOT_SEARCHED.has(def.key)) continue;
    for (const f of def.fields)
      if (f.type === "ref" && f.ref === entity) out.push({ def, field: f.name });
  }
  return out;
}

async function relatedRecords(
  db: SqlRunner,
  registry: Registry,
  top: SearchResult[],
  have: Set<string>,
  limit: number,
): Promise<SearchResult[]> {
  const out: SearchResult[] = [];
  for (const hit of top.slice(0, 2)) {
    if (!hit.entity || hit.score < 0.7) continue;
    const id = hit.to.split("/").pop() ?? "";
    for (const { def, field } of referrers(registry, hit.entity)) {
      if (out.length >= limit) return out;
      const rows = (await db.query(
        `SELECT * FROM ${def.table} WHERE deleted_at IS NULL AND ${field} = ? ORDER BY updated_at DESC LIMIT 3`,
        [id],
      )) as Rec[];
      for (const row of rows) {
        const key = `${def.key}:${row.id}`;
        if (have.has(key) || out.length >= limit) continue;
        have.add(key);
        out.push({
          id: key,
          kind: "related",
          group: "Collegati",
          title: def.title(row),
          subtitle: `${def.label} · collegato a ${hit.title}`,
          to: `e/${def.key}/${row.id}`,
          score: hit.score * 0.55,
          entity: def.key,
        });
      }
    }
  }
  return out;
}

function didYouMean(analysis: Analysis): string | null {
  if (analysis.content.length === 0) return null;
  let changed = false;
  const fixed = analysis.tokens.map((t) => {
    if (t.concepts.length > 0 || t.norm.length < 4) return t.norm;
    let best: string | null = null;
    let bestDistance = 3;
    for (const v of VOCABULARY) {
      if (Math.abs(v.length - t.norm.length) > 2) continue;
      const d = Math.min(editDistance(t.norm, v, 2), editDistance(stem(t.norm), stem(v), 2));
      if (d < bestDistance) {
        bestDistance = d;
        best = v;
      }
    }
    if (best && best !== t.norm && bestDistance <= 2) {
      changed = true;
      return best;
    }
    return t.norm;
  });
  return changed ? fixed.join(" ") : null;
}

/** Looks for a query across pages, actions and every kind of record, ranked by relevance. */
export async function search(
  db: SqlRunner,
  registry: Registry,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const analysis = analyze(query);
  if (analysis.tokens.length === 0) return { results: [], alsoLooked: [], suggestion: null };
  const limits = options.limits ?? DEFAULT_LIMITS;
  const scan = options.scan ?? 250;

  const catalog = searchCatalog(
    buildCatalog(registry),
    analysis,
    limits.actions + limits.pages + 4,
  );
  const actions = catalog.filter((r) => r.kind === "action").slice(0, limits.actions);
  const pages = catalog.filter((r) => r.kind === "page").slice(0, limits.pages);

  const records: SearchResult[] = [];
  for (const def of registry.entities) {
    if (NOT_SEARCHED.has(def.key)) continue;
    const candidates: Candidate[] = (await fetchCandidates(db, def, analysis, scan)).map((row) => ({
      row,
      def,
    }));
    for (const { row } of candidates) {
      const score = scoreRecord(def, row, analysis);
      if (score <= 0) continue;
      records.push({
        id: `${def.key}:${row.id}`,
        kind: "record",
        group: def.plural,
        title: def.title(row),
        subtitle: def.label,
        to: `e/${def.key}/${row.id}`,
        score,
        entity: def.key,
      });
    }
  }
  records.sort((a, b) => b.score - a.score);
  const topRecords = records.slice(0, limits.records);
  const have = new Set(topRecords.map((r) => r.id));
  const related = await relatedRecords(db, registry, topRecords, have, limits.related);

  const results = [...actions, ...pages, ...topRecords, ...related];
  const alsoLooked: string[] = [];
  for (const t of analysis.tokens) {
    if (t.concepts.length === 0 || t.isVerb) continue;
    for (const s of synonymsOf(t.norm, 3)) if (!alsoLooked.includes(s)) alsoLooked.push(s);
  }
  return {
    results,
    alsoLooked: alsoLooked.slice(0, 5),
    suggestion: results.length === 0 ? didYouMean(analysis) : null,
  };
}

export { MATCH_SCORE };
