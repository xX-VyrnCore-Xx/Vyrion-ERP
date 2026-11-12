/**
 * Finding and merging duplicate parties (the same customer entered twice).
 *
 * Two parties are candidates when they share a VAT number, a tax code, an email address or the
 * same name once legal forms and punctuation are ignored. Merging moves every record that points
 * at the duplicate to the one that is kept, completes the kept one with what only the duplicate
 * knew, and deletes the duplicate: all in one transaction, so it either happens fully or not.
 */

import type { Rec } from "../data/entity";
import type { Workspace } from "../data/workspace";
import { normalize } from "../search/text";

export interface DuplicateGroup {
  /** Why they look the same, in plain Italian. */
  reasons: string[];
  parties: Rec[];
}

const LEGAL_SUFFIX =
  /\b(s ?r ?l ?s?|s ?p ?a|s ?n ?c|s ?a ?s|s ?s|soc coop|coop|ditta individuale|di)\b/g;

const nameKey = (name: string): string =>
  normalize(name.replace(/\./g, ""))
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const clean = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

export async function findDuplicateParties(ws: Workspace): Promise<DuplicateGroup[]> {
  const parties = (await ws.db.query(
    "SELECT * FROM parties WHERE deleted_at IS NULL ORDER BY created_at",
  )) as unknown as Rec[];
  const parent = new Map<string, string>(parties.map((p) => [p.id, p.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  const reasons = new Map<string, Set<string>>();
  const link = (a: string, b: string, reason: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
    for (const id of [a, b]) {
      const key = find(id);
      reasons.set(key, (reasons.get(key) ?? new Set()).add(reason));
    }
  };
  const index = (label: string, key: (p: Rec) => string) => {
    const first = new Map<string, string>();
    for (const p of parties) {
      const k = key(p);
      if (!k) continue;
      const other = first.get(k);
      if (other) link(other, p.id, label);
      else first.set(k, p.id);
    }
  };
  index("stessa partita IVA", (p) => clean(p["vat_number"]));
  index("stesso codice fiscale", (p) => clean(p["tax_code"]));
  index("stessa email", (p) => clean(p["email"]));
  index("stesso nome", (p) => {
    const k = nameKey(String(p["name"] ?? ""));
    return k.length >= 4 ? k : "";
  });

  const groups = new Map<string, Rec[]>();
  for (const p of parties) groups.set(find(p.id), [...(groups.get(find(p.id)) ?? []), p]);
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => ({
      reasons: [...(reasons.get(find(root)) ?? [])],
      parties: members,
    }));
}

export interface MergeBlocker {
  entity: string;
  label: string;
  count: number;
}

/** Records pointing at `partyId` that can no longer be changed (e.g. issued invoices). */
export async function mergeBlockers(ws: Workspace, partyId: string): Promise<MergeBlocker[]> {
  const blockers: MergeBlocker[] = [];
  for (const { entity, field } of ws.registry.referencing("party")) {
    if (!entity.lockedReason) continue;
    const rows = (await ws.db.query(
      `SELECT * FROM ${entity.table} WHERE ${field.name} = ? AND deleted_at IS NULL`,
      [partyId],
    )) as unknown as Rec[];
    const locked = rows.filter((r) => entity.lockedReason?.(r));
    if (locked.length > 0)
      blockers.push({
        entity: entity.key,
        label: entity.plural.toLowerCase(),
        count: locked.length,
      });
  }
  return blockers;
}

export interface MergeResult {
  moved: number;
  filled: string[];
}

/**
 * Merges `dropId` into `keepId`. Refuses when the duplicate has issued fiscal documents: they
 * belong to that customer as it was invoiced and must not be re-addressed.
 */
export async function mergeParties(
  ws: Workspace,
  keepId: string,
  dropId: string,
): Promise<MergeResult> {
  if (keepId === dropId) throw new Error("Scegli due anagrafiche diverse");
  const blockers = await mergeBlockers(ws, dropId);
  if (blockers.length > 0) {
    const text = blockers.map((b) => `${b.count} ${b.label}`).join(", ");
    throw new Error(
      `Non unibile: ha ${text} non modificabili. Tieni questa anagrafica come principale oppure lasciale separate.`,
    );
  }
  return ws.transact(async (tx, ctx, repo) => {
    const keep = await repo("party").require(tx, keepId);
    const drop = await repo("party").require(tx, dropId);
    let moved = 0;
    for (const { entity, field } of ws.registry.referencing("party")) {
      const rows = await tx.query<{ id: string }>(
        `SELECT id FROM ${entity.table} WHERE ${field.name} = ? AND deleted_at IS NULL`,
        [dropId],
      );
      for (const row of rows) {
        await repo(entity.key).update(tx, ctx, row.id, { [field.name]: keepId });
        moved++;
      }
    }
    // Remove the duplicate first: unique values (VAT number) are then free to move over.
    await repo("party").remove(tx, ctx, dropId);
    const patch: Record<string, unknown> = {};
    const filled: string[] = [];
    for (const field of ws.registry.get("party").fields) {
      if (field.readonly || field.hidden) continue;
      const mine = keep[field.name];
      const theirs = drop[field.name];
      const empty = mine === null || mine === undefined || mine === "";
      if (empty && theirs !== null && theirs !== undefined && theirs !== "") {
        patch[field.name] = theirs;
        filled.push(field.label);
      }
    }
    // Notes are never lost: the duplicate's note is appended to the kept one.
    const dropNote = String(drop["notes"] ?? "").trim();
    if (dropNote && String(keep["notes"] ?? "").trim() && keep["notes"] !== dropNote) {
      patch["notes"] =
        `${String(keep["notes"])}\n\n[Unita da «${String(drop["name"])}»] ${dropNote}`;
      filled.push("Note");
    }
    if (Object.keys(patch).length > 0) await repo("party").update(tx, ctx, keepId, patch);
    return { moved, filled };
  });
}
