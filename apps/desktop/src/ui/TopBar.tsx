import { Bell } from "lucide-react";

import { useAsync, useWorkspace } from "../app/context";
import { useSync } from "../app/sync";
import { relativeTime, summarizeSync, type SyncTone } from "../app/syncStatus";
import { notifications } from "../modules/insights";
import { SearchBox } from "./SearchBox";

const DOT: Record<SyncTone, string> = {
  ok: "bg-success",
  info: "bg-info animate-pulse",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted",
};

export function TopBar({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const alerts = useAsync(() => notifications(ws.db, ws.ctx.today(), ws.ctx.now()), []);
  const count = alerts.data?.length ?? 0;
  const sync = useSync();
  const summary = summarizeSync(sync);
  return (
    <div className="relative flex items-center gap-3 border-b border-line bg-surface px-8 py-3">
      <SearchBox go={go} />
      {summary ? (
        <a
          href="#/settings/account"
          title={`Ultimo scambio: ${relativeTime(sync.lastSyncAt)}`}
          className={`ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
            summary.tone === "danger" ? "border-danger/50 text-danger" : "border-line text-muted"
          }`}
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[summary.tone]}`} />
          {summary.label}
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => go("")}
        aria-label={count ? `${count} avvisi da controllare` : "Nessun avviso"}
        className={`relative ${summary ? "" : "ml-auto"} rounded-lg border border-line bg-raised p-2 text-muted hover:text-fg`}
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
