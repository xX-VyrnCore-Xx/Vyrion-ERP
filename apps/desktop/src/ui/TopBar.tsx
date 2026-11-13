import { useSync } from "../app/sync";
import { relativeTime, summarizeSync, type SyncTone } from "../app/syncStatus";
import { NotificationsMenu } from "./NotificationsMenu";
import { SearchBox } from "./SearchBox";

const DOT: Record<SyncTone, string> = {
  ok: "bg-success",
  info: "bg-info animate-pulse",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted",
};

export function TopBar({ go }: { go: (to: string) => void }) {
  const sync = useSync();
  const summary = summarizeSync(sync);
  return (
    <div className="relative z-10 flex items-center gap-3 border-b border-line bg-surface px-8 py-2.5">
      <SearchBox go={go} />
      {summary ? (
        <a
          href="#/settings/account"
          title={`Ultimo scambio: ${relativeTime(sync.lastSyncAt)}`}
          className={`ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-raised ${
            summary.tone === "danger" ? "border-danger/50 text-danger" : "border-line text-muted"
          }`}
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[summary.tone]}`} />
          {summary.label}
        </a>
      ) : null}
      <div className={summary ? "" : "ml-auto"}>
        <NotificationsMenu go={go} />
      </div>
    </div>
  );
}
