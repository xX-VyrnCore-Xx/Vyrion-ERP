import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { inDesktop, native, type SystemSnapshot } from "../lib/native";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatInstant } from "../ui/format";

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function MonitorPage() {
  const ws = useWorkspace();
  const desktop = inDesktop();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);

  const data = useAsync(async () => {
    const checks = (await ws.list("monitor_check", { limit: 200, orderBy: "name asc" })).rows;
    const results = await ws.db.query<{
      check_id: string;
      at: string;
      up: number;
      latency_ms: number | null;
      error: string | null;
    }>(
      `SELECT check_id, at, up, latency_ms, error FROM monitor_results r
       WHERE id = (SELECT id FROM monitor_results x WHERE x.check_id = r.check_id ORDER BY at DESC, id DESC LIMIT 1)`,
    );
    return { checks, last: new Map(results.map((r) => [r.check_id, r])) };
  }, []);

  const runAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      for (const check of data.data?.checks ?? []) {
        if (!check["enabled"]) continue;
        const result = await native
          .tcpCheck(String(check["host"]), Number(check["port"]), 3000)
          .catch((e: unknown) => ({
            ok: false,
            elapsed_ms: 0,
            address: null,
            error: e instanceof Error ? e.message : String(e),
          }));
        await ws.db.execute(
          "INSERT INTO monitor_results (check_id, at, up, latency_ms, error) VALUES (?, ?, ?, ?, ?)",
          [
            check.id,
            ws.ctx.now(),
            result.ok ? 1 : 0,
            result.ok ? result.elapsed_ms : null,
            result.error,
          ],
        );
      }
      ws.touch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshSystem = async () => {
    try {
      setSnapshot(await native.systemSnapshot());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Controlli di rete"
        subtitle="Prova se questo computer riesce a raggiungere host e porte TCP (anche attraverso la VPN). Il risultato è quello visto da qui."
      />
      <ErrorNote message={message ?? data.error} />
      <div className="space-y-4">
        <Card title="Raggiungibilità">
          <div className="mb-3 flex gap-2">
            <Button
              variant="primary"
              disabled={!desktop || busy || !data.data?.checks.length}
              onClick={() => void runAll()}
            >
              {busy ? "Controllo in corso…" : "Controlla ora"}
            </Button>
            <a
              className="self-center text-sm text-accent hover:underline"
              href={href("e", "monitor_check", "new")}
            >
              Aggiungi un controllo
            </a>
          </div>
          {!desktop ? (
            <p className="mb-3 text-sm text-muted">
              I controlli di rete sono disponibili nell'applicazione desktop.
            </p>
          ) : null}
          {data.data?.checks.length === 0 ? (
            <Empty>Nessun controllo configurato.</Empty>
          ) : (
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Nome", "Destinazione", "Ultimo esito", "Latenza", "Verificato"].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data?.checks.map((c) => {
                  const last = data.data?.last.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td className={TD}>
                        <a
                          className="text-fg hover:text-accent"
                          href={href("e", "monitor_check", c.id)}
                        >
                          {String(c["name"])}
                        </a>
                      </td>
                      <td className={TD}>
                        {String(c["host"])}:{String(c["port"])}
                      </td>
                      <td className={TD}>
                        {!last ? (
                          <Badge>Mai controllato</Badge>
                        ) : last.up ? (
                          <Badge tone="success">Raggiungibile</Badge>
                        ) : (
                          <Badge tone="danger">Non raggiungibile</Badge>
                        )}
                        {last?.error ? (
                          <span className="ml-2 text-xs text-muted">{last.error}</span>
                        ) : null}
                      </td>
                      <td className={TD}>
                        {last?.latency_ms != null ? `${last.latency_ms} ms` : ""}
                      </td>
                      <td className={TD}>{last ? formatInstant(last.at) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Questo computer">
          {!desktop ? (
            <p className="text-sm text-muted">Disponibile nell'applicazione desktop.</p>
          ) : snapshot ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Nome</dt>
              <dd>{snapshot.hostname ?? "—"}</dd>
              <dt className="text-muted">Sistema</dt>
              <dd>
                {snapshot.os_name} {snapshot.os_version} · {snapshot.arch}
              </dd>
              <dt className="text-muted">Processore</dt>
              <dd>
                {snapshot.cpu_brand} ({snapshot.cpu_count} core) ·{" "}
                {snapshot.cpu_usage_percent.toFixed(0)}%
              </dd>
              <dt className="text-muted">Memoria</dt>
              <dd>
                {gb(snapshot.memory_used_bytes)} / {gb(snapshot.memory_total_bytes)}
              </dd>
              <dt className="text-muted">Attivo da</dt>
              <dd>{Math.floor(snapshot.uptime_seconds / 3600)} ore</dd>
              {snapshot.disks.map((d) => (
                <div key={d.mount} className="contents">
                  <dt className="text-muted">Disco {d.mount}</dt>
                  <dd>
                    {gb(d.available_bytes)} liberi su {gb(d.total_bytes)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted">
              Premi «Aggiorna» per leggere le risorse di questo computer.
            </p>
          )}
          {desktop ? (
            <Button className="mt-3" onClick={() => void refreshSystem()}>
              Aggiorna
            </Button>
          ) : null}
        </Card>
      </div>
    </>
  );
}
