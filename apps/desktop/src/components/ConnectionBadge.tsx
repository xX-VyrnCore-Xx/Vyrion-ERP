import type { ConnectionState } from "../hooks/useServerStatus";
import { t } from "../i18n/it";

const DOT: Record<ConnectionState, string> = {
  unconfigured: "bg-muted",
  checking: "bg-info animate-pulse",
  online: "bg-success",
  degraded: "bg-warning",
  offline: "bg-danger",
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1 text-xs font-medium text-fg"
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[state]}`} />
      {t.connection[state]}
    </span>
  );
}
