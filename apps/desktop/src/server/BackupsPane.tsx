import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { formatInstant } from "../ui/format";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import type { BackupOverview, BackupRun } from "./types";
import { useRemote } from "./useRemote";

const KIND: Record<BackupRun["kind"], string> = {
  backup: "Backup",
  verify: "Controllo integrità",
  restore_test: "Prova di ripristino",
};
const TIER = { daily: "Giornaliero", weekly: "Settimanale", monthly: "Mensile" } as const;

const size = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} B`;

function Summary({ label, run, hint }: { label: string; run: BackupRun | null; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-raised p-3">
      <div className="text-xs text-muted">{label}</div>
      {run ? (
        <>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={run.ok ? "success" : "danger"}>{run.ok ? "Riuscito" : "Fallito"}</Badge>
            <span className="text-sm text-fg">{formatInstant(run.finished_at)}</span>
          </div>
          {run.error ? <p className="mt-1 text-xs text-danger">{run.error}</p> : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">{hint}</p>
      )}
    </div>
  );
}

/** What the backup service really did: from its own run log, never invented. */
export function BackupsPane() {
  const sync = useSync();
  const data = useRemote(() => sync.request<BackupOverview>("GET", "/backups"), []);
  const o = data.data;
  return (
    <div className="space-y-4">
      <Card title="Backup del server">
        <div className="mb-4 flex items-center justify-between gap-3">
          {o ? (
            o.stale ? (
              <Badge tone="danger">
                {o.configured
                  ? `Nessun backup riuscito nelle ultime ${o.stale_after_hours} ore`
                  : "Servizio di backup non attivo"}
              </Badge>
            ) : (
              <Badge tone="success">Backup aggiornati</Badge>
            )
          ) : (
            <span />
          )}
          <Button onClick={data.reload}>Aggiorna</Button>
        </div>
        <ErrorNote message={data.error} />
        {o && !o.configured ? (
          <Empty>
            Il servizio di backup non ha ancora scritto nulla. Attivalo seguendo docs/BACKUP.md
            (chiave pubblica age in BACKUP_AGE_RECIPIENT).
          </Empty>
        ) : null}
        {o && o.configured ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary label="Ultimo backup" run={o.last_backup} hint="Nessuno" />
            <Summary
              label="Ultimo controllo di integrità"
              run={o.last_verify}
              hint="Non ancora eseguito"
            />
            <Summary
              label="Ultima prova di ripristino"
              run={o.last_restore_test}
              hint="Mai eseguita: un backup mai ripristinato non è garantito"
            />
          </div>
        ) : null}
      </Card>

      {o && o.files.length > 0 ? (
        <Card title="Copie conservate">
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>File</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>Dimensione</th>
                  <th className={TH}>Creato</th>
                </tr>
              </thead>
              <tbody>
                {o.files.map((f) => (
                  <tr key={`${f.tier}/${f.name}`}>
                    <td className={`${TD} break-all`}>{f.name}</td>
                    <td className={TD}>{TIER[f.tier]}</td>
                    <td className={`${TD} tabular-nums`}>{size(f.size_bytes)}</td>
                    <td className={TD}>{formatInstant(f.modified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {o && o.runs.length > 0 ? (
        <Card title="Storico esecuzioni">
          <ul className="divide-y divide-line/60 text-sm">
            {o.runs.slice(0, 30).map((r, i) => (
              <li key={`${r.finished_at}-${i}`} className="flex flex-wrap items-center gap-3 py-2">
                <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "OK" : "Errore"}</Badge>
                <span className="text-fg">{KIND[r.kind]}</span>
                <span className="text-muted">{formatInstant(r.finished_at)}</span>
                {r.size_bytes > 0 ? <span className="text-muted">{size(r.size_bytes)}</span> : null}
                {r.error ? <span className="text-xs text-danger">{r.error}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
