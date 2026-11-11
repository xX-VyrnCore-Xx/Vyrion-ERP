import { Bell, Search } from "lucide-react";
import { useState } from "react";

import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { globalSearch, notifications } from "../modules/insights";

export function TopBar({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const [term, setTerm] = useState("");
  const hits = useAsync(() => globalSearch(ws.db, ws.registry, term), [term]);
  const alerts = useAsync(() => notifications(ws.db, ws.ctx.today(), ws.ctx.now()), []);
  const count = alerts.data?.length ?? 0;
  return (
    <div className="relative flex items-center gap-3 border-b border-line bg-surface px-8 py-3">
      <div className="relative w-full max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          aria-label="Cerca in tutto Vyrion"
          placeholder="Cerca clienti, documenti, asset…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setTerm("")}
          className="w-full rounded-lg border border-line bg-raised py-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted"
        />
        {term.trim().length >= 2 ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
            {hits.data?.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">Nessun risultato.</p>
            ) : null}
            {hits.data?.map((hit) => (
              <a
                key={`${hit.entity}:${hit.id}`}
                href={href("e", hit.entity, hit.id)}
                onClick={() => setTerm("")}
                className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-raised"
              >
                <span className="truncate text-fg">{hit.title}</span>
                <span className="shrink-0 text-xs text-muted">{hit.label}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => go("")}
        aria-label={count ? `${count} avvisi da controllare` : "Nessun avviso"}
        className="relative ml-auto rounded-lg border border-line bg-raised p-2 text-muted hover:text-fg"
      >
        <Bell aria-hidden="true" className="size-4" />
        {count ? (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
    </div>
  );
}
