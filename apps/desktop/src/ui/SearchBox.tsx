import { ArrowRight, CornerDownLeft, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useAsync, useWorkspace } from "../app/context";
import { search, type SearchResult } from "../search/engine";
import { words } from "../search/text";

const RECENT_KEY = "vyrion.recentSearches";
const SUGGESTIONS = [
  "fatture scadute",
  "nuovo cliente",
  "incassi",
  "backup",
  "licenze",
  "tema scuro",
];

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((x): x is string => typeof x === "string").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function remember(term: string): string[] {
  const clean = term.trim();
  if (clean.length < 2) return readRecent();
  const next = [clean, ...readRecent().filter((t) => t !== clean)].slice(0, 5);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* the list lasts only for this session */
  }
  return next;
}

/** Waits a moment after the last keystroke before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** The text with the words of the query marked, ignoring case and accents. */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const folded = [...text]
      .map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())
      .join("");
    const marks = new Array<boolean>(folded.length).fill(false);
    for (const word of words(query)) {
      if (word.length < 2) continue;
      let from = 0;
      for (;;) {
        const at = folded.indexOf(word, from);
        if (at < 0) break;
        for (let i = at; i < at + word.length; i++) marks[i] = true;
        from = at + word.length;
      }
    }
    const chars = [...text];
    const out: { text: string; on: boolean }[] = [];
    chars.forEach((ch, i) => {
      const on = marks[i] ?? false;
      const last = out[out.length - 1];
      if (last && last.on === on) last.text += ch;
      else out.push({ text: ch, on });
    });
    return out;
  }, [text, query]);
  return (
    <>
      {parts.map((p, i) =>
        p.on ? (
          <mark key={i} className="rounded-sm bg-accent/20 px-px text-fg">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const ICON = { action: Plus, page: ArrowRight, record: Search, related: Sparkles } as const;

/** The search of the whole software: pages, actions and records, ranked, with the keyboard. */
export function SearchBox({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const query = useDebounced(term, 130);
  const searching = query.trim().length >= 2;
  const found = useAsync(
    () => (searching ? search(ws.db, ws.registry, query) : Promise.resolve(null)),
    [query, searching],
  );
  const results: SearchResult[] = searching ? (found.data?.results ?? []) : [];

  // Ctrl/Cmd+K, or "/" outside a field, jumps to the search.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(input|textarea|select)$/i.test(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // A new set of results starts again from the first one.
  const [seen, setSeen] = useState(found.data);
  if (seen !== found.data) {
    setSeen(found.data);
    setActive(0);
  }

  const choose = (to: string) => {
    setRecent(remember(term));
    setTerm("");
    setOpen(false);
    inputRef.current?.blur();
    go(to);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      const hit = results[active];
      if (hit) {
        event.preventDefault();
        choose(hit.to);
      }
    } else if (event.key === "Escape") {
      if (term) setTerm("");
      else {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
  };

  // The list is shown in groups, in the order the results are ranked.
  const groups: { name: string; items: { result: SearchResult; index: number }[] }[] = [];
  results.forEach((result, index) => {
    let group = groups.find((g) => g.name === result.group);
    if (!group) {
      group = { name: result.group, items: [] };
      groups.push(group);
    }
    group.items.push({ result, index });
  });

  const showPanel = open;
  const usedSuggestion = found.data?.suggestion ?? null;
  return (
    <div ref={root} className="relative w-full max-w-md">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Cerca in tutto Vyrion"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-activedescendant={showPanel && results[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder="Cerca clienti, fatture, pagine, azioni…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-line bg-raised py-2 pl-9 pr-14 text-sm text-fg placeholder:text-muted"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
      >
        Ctrl K
      </kbd>
      {showPanel ? (
        <div
          className="pop-in absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[26rem] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop"
          style={{ transformOrigin: "top center" }}
        >
          {!searching ? (
            <div className="px-2 py-1.5">
              {recent.length > 0 ? (
                <>
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Recenti
                  </p>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {recent.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTerm(t)}
                        className="rounded-full border border-line px-2.5 py-1 text-xs text-fg hover:border-accent"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Prova a cercare
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTerm(t)}
                    className="rounded-full bg-raised px-2.5 py-1 text-xs text-muted hover:text-fg"
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 px-1 text-[11px] text-muted">
                Capisce sinonimi ed errori di battitura: «incassi», «committente», «fatura».
              </p>
            </div>
          ) : (
            <>
              {found.data && found.data.alsoLooked.length > 0 && results.length > 0 ? (
                <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted">
                  Cerco anche: {found.data.alsoLooked.join(", ")}
                </p>
              ) : null}
              <div id={listId} role="listbox" aria-label="Risultati della ricerca">
                {groups.map((group) => (
                  <div key={group.name} role="group" aria-label={group.name}>
                    <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {group.name}
                    </p>
                    {group.items.map(({ result, index }) => {
                      const Icon = ICON[result.kind];
                      const isActive = index === active;
                      return (
                        <a
                          key={result.id}
                          id={`${listId}-${index}`}
                          role="option"
                          aria-selected={isActive}
                          href={`#/${result.to}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseMove={() => setActive(index)}
                          onClick={(e) => {
                            e.preventDefault();
                            choose(result.to);
                          }}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${isActive ? "bg-raised" : ""}`}
                        >
                          <Icon
                            aria-hidden="true"
                            className={`size-3.5 shrink-0 ${isActive ? "text-accent" : "text-muted"}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-fg">
                              <Highlight text={result.title} query={query} />
                            </span>
                            {result.subtitle ? (
                              <span className="block truncate text-[11px] text-muted">
                                {result.subtitle}
                              </span>
                            ) : null}
                          </span>
                          {isActive ? (
                            <CornerDownLeft
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-muted"
                            />
                          ) : null}
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
              {found.loading && results.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted">Cerco…</p>
              ) : null}
              {!found.loading && results.length === 0 ? (
                <div className="px-3 py-2.5 text-sm text-muted">
                  <p>Nessun risultato per «{query.trim()}».</p>
                  {usedSuggestion ? (
                    <p className="mt-1">
                      Intendevi{" "}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTerm(usedSuggestion)}
                        className="text-accent underline underline-offset-2"
                      >
                        {usedSuggestion}
                      </button>
                      ?
                    </p>
                  ) : (
                    <p className="mt-1 text-xs">
                      Prova con altre parole, un numero o il nome di un cliente.
                    </p>
                  )}
                </div>
              ) : null}
              {results.length > 0 ? (
                <p className="border-t border-line px-2 pb-0.5 pt-1.5 text-[11px] text-muted">
                  ↑↓ per scegliere · Invio per aprire · Esc per chiudere
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
