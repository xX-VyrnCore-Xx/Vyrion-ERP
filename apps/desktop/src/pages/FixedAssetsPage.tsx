import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { formatMoney } from "../lib/money";
import {
  depreciationSchedule,
  pendingDepreciation,
  postDepreciation,
  termsOf,
} from "../modules/depreciation";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay } from "../ui/format";

/** Fixed assets and their yearly depreciation. */
export function FixedAssetsPage() {
  const ws = useWorkspace();
  const thisYear = Number(ws.ctx.today().slice(0, 4));
  const [year, setYear] = useState(thisYear - 1);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const data = useAsync(async () => {
    const assets = (await ws.list("fixed_asset", { limit: 500, orderBy: "purchase_date asc" }))
      .rows;
    return { assets, pending: await pendingDepreciation(ws, year) };
  }, [year]);

  const post = async () => {
    setMessage(null);
    try {
      const done = await postDepreciation(ws, year);
      setMessage({
        ok: true,
        text: done.length
          ? `Registrato l'ammortamento ${year}: ${formatMoney(done.reduce((s, d) => s + d.amount, 0))} su ${done.length} cespiti.`
          : `Niente da registrare per il ${year}.`,
      });
      ws.touch();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const todo = data.data?.pending.filter((p) => !p.posted) ?? [];
  const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
  return (
    <>
      <PageHeader
        title="Cespiti e ammortamenti"
        subtitle="Beni durevoli ammortizzati a quote costanti; nel primo anno si applica metà dell'aliquota."
      />
      <ErrorNote message={data.error} />
      <div className="space-y-4">
        <Card title="Ammortamento dell'anno">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-fg">
              Anno
              <input
                type="number"
                aria-label="Anno"
                className={`${input} w-24`}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </label>
            <Button variant="primary" disabled={todo.length === 0} onClick={() => void post()}>
              Registra l'ammortamento {year}
            </Button>
            <a
              href={href("e", "fixed_asset", "new")}
              className="text-sm text-accent hover:underline"
            >
              Nuovo cespite
            </a>
          </div>
          {message ? (
            message.ok ? (
              <p role="status" className="mb-3 text-sm text-success">
                {message.text}
              </p>
            ) : (
              <div className="mb-3">
                <ErrorNote message={message.text} />
              </div>
            )
          ) : null}
          {data.data && data.data.pending.length === 0 ? (
            <Empty>Nessun ammortamento per il {year}.</Empty>
          ) : (
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Cespite
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Quota {year}
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Stato</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data?.pending.map((p) => (
                  <tr key={p.assetId}>
                    <td className={TD}>{p.name}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMoney(p.amount)}</td>
                    <td className={TD}>
                      <Badge tone={p.posted ? "success" : "warning"}>
                        {p.posted ? "Registrato" : "Da registrare"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Registro dei cespiti">
          {data.data && data.data.assets.length === 0 ? (
            <Empty>Nessun cespite registrato.</Empty>
          ) : (
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Descrizione", "Acquisto"].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                  {["Costo", "Fondo", "Valore residuo"].map((h) => (
                    <th key={h} scope="col" className={`${TH} text-right`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data?.assets.map((a) => {
                  const rows = depreciationSchedule(termsOf(a), year);
                  const last = rows[rows.length - 1];
                  return (
                    <tr key={a.id}>
                      <td className={TD}>
                        <a
                          className="text-fg hover:text-accent"
                          href={href("e", "fixed_asset", a.id)}
                        >
                          {String(a["name"])}
                        </a>
                      </td>
                      <td className={TD}>{formatDay(String(a["purchase_date"]))}</td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {formatMoney(Number(a["cost"]))}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {formatMoney(last?.accumulated ?? 0)}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {formatMoney(last?.bookValue ?? Number(a["cost"]))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted">
            Fondo e valore residuo sono calcolati al 31/12/{year}.
          </p>
        </Card>
      </div>
    </>
  );
}
