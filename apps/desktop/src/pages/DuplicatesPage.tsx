import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import {
  findDuplicateParties,
  mergeBlockers,
  mergeParties,
  type DuplicateGroup,
} from "../modules/duplicates";
import { Badge, ConfirmDialog, Empty, ErrorNote } from "../ui/parts";

interface Pending {
  keep: string;
  drop: string;
  keepName: string;
  dropName: string;
}

/** Customers and suppliers entered twice: pick the one to keep and merge the rest into it. */
export function DuplicatesPage() {
  const ws = useWorkspace();
  const groups = useAsync(async () => {
    const found = await findDuplicateParties(ws);
    // What stops a party from being merged away is looked up once per party.
    const blocked = new Map<string, string>();
    for (const group of found)
      for (const p of group.parties) {
        const b = await mergeBlockers(ws, p.id);
        if (b.length > 0) blocked.set(p.id, b.map((x) => `${x.count} ${x.label}`).join(", "));
      }
    return { found, blocked };
  }, []);
  const [keepers, setKeepers] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const merge = async () => {
    if (!pending) return;
    const target = pending;
    setPending(null);
    try {
      const result = await mergeParties(ws, target.keep, target.drop);
      setMessage({
        ok: true,
        text: `«${target.dropName}» unita a «${target.keepName}»: ${result.moved} record spostati${
          result.filled.length ? `, completati ${result.filled.join(", ")}` : ""
        }.`,
      });
      ws.touch();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const list = groups.data?.found ?? [];
  return (
    <>
      <PageHeader
        title="Anagrafiche duplicate"
        subtitle="Clienti e fornitori inseriti più volte: stessa partita IVA, codice fiscale, email o nome."
      />
      <ErrorNote message={groups.error} />
      {message ? (
        <p role="status" className={`mb-4 text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      ) : null}
      {groups.data && list.length === 0 ? (
        <Empty>Nessun duplicato trovato.</Empty>
      ) : (
        <div className="space-y-4">
          {list.map((group: DuplicateGroup, gi) => {
            const keep = keepers[gi] ?? group.parties[0]?.id;
            const keeper = group.parties.find((p) => p.id === keep);
            return (
              <Card
                key={group.parties.map((p) => p.id).join("-")}
                title={group.reasons.join(" · ")}
              >
                <ul className="divide-y divide-line/60">
                  {group.parties.map((p) => {
                    const blocked = groups.data?.blocked.get(p.id);
                    const isKeeper = p.id === keep;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <input
                            type="radio"
                            aria-label={`Tieni ${String(p["name"])}`}
                            name={`keep-${gi}`}
                            checked={isKeeper}
                            onChange={() => setKeepers((k) => ({ ...k, [gi]: p.id }))}
                            className="size-4 accent-[var(--accent)]"
                          />
                          <span className="min-w-0">
                            <a
                              href={href("e", "party", p.id)}
                              className="font-medium text-fg hover:text-accent"
                            >
                              {String(p["name"])}
                            </a>
                            <span className="block truncate text-xs text-muted">
                              {[p["vat_number"], p["email"], p["city"]]
                                .filter(Boolean)
                                .join(" · ") || "nessun altro dato"}
                            </span>
                          </span>
                        </div>
                        {isKeeper ? <Badge tone="success">Da tenere</Badge> : null}
                        {blocked ? <Badge tone="warning">Ha {blocked}</Badge> : null}
                        {!isKeeper && keeper ? (
                          <Button
                            disabled={Boolean(blocked)}
                            title={
                              blocked
                                ? "Ha documenti emessi: tienila come principale"
                                : "Unisci questa anagrafica a quella da tenere"
                            }
                            onClick={() =>
                              setPending({
                                keep: keeper.id,
                                drop: p.id,
                                keepName: String(keeper["name"]),
                                dropName: String(p["name"]),
                              })
                            }
                          >
                            Unisci in «{String(keeper["name"])}»
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {pending ? (
        <ConfirmDialog
          title="Unire le anagrafiche?"
          message={`«${pending.dropName}» verrà eliminata e tutti i suoi contatti, opportunità, ticket e documenti passeranno a «${pending.keepName}». I dati mancanti vengono completati. L'operazione è registrata nello storico.`}
          confirmLabel="Unisci"
          onCancel={() => setPending(null)}
          onConfirm={() => void merge()}
        />
      ) : null}
    </>
  );
}
