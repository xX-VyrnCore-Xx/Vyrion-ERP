import { Bell } from "lucide-react";

import { useAsync, useWorkspace } from "../app/context";
import { useSync } from "../app/sync";
import { notifications } from "../modules/insights";
import { SearchBox } from "./SearchBox";

export function TopBar({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const alerts = useAsync(() => notifications(ws.db, ws.ctx.today(), ws.ctx.now()), []);
  const count = alerts.data?.length ?? 0;
  const sync = useSync();
  return (
    <div className="relative flex items-center gap-3 border-b border-line bg-surface px-8 py-3">
      <SearchBox go={go} />
      {sync.connected ? (
        <a
          href="#/settings"
          className={`ml-auto rounded-lg border px-3 py-1.5 text-xs ${sync.conflicts.length ? "border-danger/50 text-danger" : "border-line text-muted"}`}
        >
          {sync.conflicts.length
            ? `${sync.conflicts.length} conflitti da risolvere`
            : sync.syncing
              ? "Sincronizzazione…"
              : sync.error
                ? "Offline: modifiche in attesa"
                : sync.pending
                  ? `${sync.pending} in attesa di invio`
                  : "Sincronizzato"}
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => go("")}
        aria-label={count ? `${count} avvisi da controllare` : "Nessun avviso"}
        className={`relative ${sync.connected ? "" : "ml-auto"} rounded-lg border border-line bg-raised p-2 text-muted hover:text-fg`}
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
