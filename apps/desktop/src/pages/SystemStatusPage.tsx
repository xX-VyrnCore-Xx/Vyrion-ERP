import { RefreshCw } from "lucide-react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { ConnectionBadge } from "../components/ConnectionBadge";
import type { ServerStatus } from "../hooks/useServerStatus";
import { t } from "../i18n/it";

const COMPONENT_LABELS: Record<string, string> = {
  database: t.status.database,
  redis: t.status.redis,
};

const timeFormat = new Intl.DateTimeFormat("it-IT", { timeStyle: "medium" });

interface Props {
  serverUrl: string | null;
  status: ServerStatus;
  onOpenSettings: () => void;
}

export function SystemStatusPage({ serverUrl, status, onOpenSettings }: Props) {
  const { state, version, components, lastCheckedAt, checkNow } = status;

  return (
    <>
      <PageHeader title={t.status.title} subtitle={t.status.subtitle} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.status.server}>
          <div className="mb-4">
            <ConnectionBadge state={state} />
          </div>
          {state === "unconfigured" ? (
            <>
              <p className="mb-4 text-sm text-muted">{t.status.unconfiguredHint}</p>
              <Button variant="primary" onClick={onOpenSettings}>
                {t.status.openSettings}
              </Button>
            </>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted">{t.settings.serverUrl}</dt>
                <dd className="truncate text-fg">{serverUrl}</dd>
                <dt className="text-muted">{t.status.serverVersion}</dt>
                <dd className="text-fg">{version ?? "—"}</dd>
                <dt className="text-muted">{t.status.lastCheck}</dt>
                <dd className="text-fg">
                  {lastCheckedAt ? timeFormat.format(lastCheckedAt) : t.status.never}
                </dd>
              </dl>
              {state === "offline" && (
                <p role="alert" className="mb-4 text-sm text-muted">
                  {t.status.offlineHint}
                </p>
              )}
              <Button onClick={checkNow}>
                <RefreshCw aria-hidden="true" className="size-4" />
                {t.status.retry}
              </Button>
            </>
          )}
        </Card>

        <Card title={t.status.components}>
          {components ? (
            <ul className="divide-y divide-line">
              {Object.entries(components).map(([name, component]) => (
                <li key={name} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-fg">{COMPONENT_LABELS[name] ?? name}</span>
                  <span className="flex items-center gap-3">
                    {component.latencyMs !== null && (
                      <span className="tabular-nums text-muted">
                        {t.status.latency(component.latencyMs)}
                      </span>
                    )}
                    <span className={component.status === "ok" ? "text-success" : "text-danger"}>
                      {component.status === "ok" ? t.status.componentOk : t.status.componentError}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t.status.noComponentData}</p>
          )}
        </Card>
      </div>
    </>
  );
}
