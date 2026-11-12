import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatMoney } from "../lib/money";
import {
  profitAndLoss,
  projectSummary,
  toCsv,
  trialBalance,
  vatSummary,
  withholdingSummary,
} from "../modules/reports";
import { ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { saveText } from "../ui/saveText";

const cents = (n: number) => n / 100;

export function ReportsPage() {
  const ws = useWorkspace();
  const year = ws.ctx.today().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [message, setMessage] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  const data = useAsync(async () => {
    if (!valid) return null;
    return {
      tb: await trialBalance(ws.db, from, to),
      pl: await profitAndLoss(ws.db, from, to),
      vat: await vatSummary(ws.db, from, to),
      withholding: await withholdingSummary(ws.db, from, to),
      projects: await projectSummary(ws.db),
    };
  }, [from, to]);

  const exportCsv = async (name: string, job: () => string) => {
    setMessage(null);
    try {
      await saveText(`${name}_${from}_${to}.csv`, job());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
  const d = data.data;

  return (
    <>
      <PageHeader
        title="Report"
        subtitle="Calcolati dalle registrazioni contabili e dai documenti emessi nel periodo."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted">
        <label>
          Dal{" "}
          <input
            aria-label="Dal"
            type="date"
            className={input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Al{" "}
          <input
            aria-label="Al"
            type="date"
            className={input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {!valid ? (
          <span role="alert" className="text-danger">
            Periodo non valido.
          </span>
        ) : null}
      </div>
      <ErrorNote message={message ?? data.error} />
      {d ? (
        <div className="space-y-4">
          <Card title="Conto economico">
            <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Ricavi</dt>
              <dd className="text-right tabular-nums">{formatMoney(d.pl.revenue)}</dd>
              <dt className="text-muted">Costi</dt>
              <dd className="text-right tabular-nums">{formatMoney(d.pl.expenses)}</dd>
              <dt className="font-semibold text-fg">Risultato</dt>
              <dd
                className={`text-right font-semibold tabular-nums ${d.pl.result < 0 ? "text-danger" : "text-success"}`}
              >
                {formatMoney(d.pl.result)}
              </dd>
            </dl>
          </Card>

          <Card title="Riepilogo IVA del periodo">
            <p className="mb-3 text-xs text-muted">
              Riepilogo di lavoro per la liquidazione periodica, non la dichiarazione. Le note di
              credito sottraggono.
            </p>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Registro
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Aliquota
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Imponibile
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    IVA
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.vat.rows.map((r) => (
                  <tr key={`${r.direction}${r.rate}`}>
                    <td className={TD}>{r.direction === "sales" ? "Vendite" : "Acquisti"}</td>
                    <td className={`${TD} text-right`}>{r.rate}%</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.base)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.vat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm">
              {d.vat.balance >= 0 ? "IVA da versare" : "IVA a credito"}:{" "}
              <strong className="tabular-nums">{formatMoney(Math.abs(d.vat.balance))}</strong>
            </p>
            <Button
              className="mt-3"
              onClick={() =>
                void exportCsv("iva", () =>
                  toCsv(
                    [
                      { key: "direction", label: "Registro" },
                      { key: "rate", label: "Aliquota" },
                      { key: "base", label: "Imponibile" },
                      { key: "vat", label: "IVA" },
                    ],
                    d.vat.rows.map((r) => ({
                      direction: r.direction === "sales" ? "Vendite" : "Acquisti",
                      rate: r.rate,
                      base: cents(r.base),
                      vat: cents(r.vat),
                    })),
                  ),
                )
              }
            >
              Esporta CSV
            </Button>
          </Card>

          {d.vat.splitVat !== 0 ? (
            <p className="text-sm text-muted">
              IVA in split payment del periodo:{" "}
              <strong className="tabular-nums">{formatMoney(d.vat.splitVat)}</strong> (versata dagli
              enti, non inclusa nel saldo IVA qui sopra).
            </p>
          ) : null}

          {d.withholding.rows.length > 0 ? (
            <Card title="Ritenute d'acconto del periodo">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Documento
                    </th>
                    <th scope="col" className={TH}>
                      Controparte
                    </th>
                    <th scope="col" className={TH}>
                      Tipo
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Importo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.withholding.rows.map((r) => (
                    <tr key={r.documentId}>
                      <td className={TD}>{r.number}</td>
                      <td className={TD}>{r.party}</td>
                      <td className={TD}>{r.kind === "suffered" ? "Subita" : "Operata"}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm text-muted">
                Subite (credito d'imposta):{" "}
                <strong className="tabular-nums">{formatMoney(d.withholding.suffered)}</strong>
                {" · "}Operate (da versare entro il 16 del mese successivo):{" "}
                <strong className="tabular-nums">{formatMoney(d.withholding.operated)}</strong>
              </p>
            </Card>
          ) : null}

          <Card title="Bilancio di verifica">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Conto
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Dare
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Avere
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.tb
                  .filter((r) => r.debit || r.credit)
                  .map((r) => (
                    <tr key={r.code}>
                      <td className={TD}>
                        {r.code} · {r.name}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.debit)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.credit)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.balance)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <Button
              className="mt-3"
              onClick={() =>
                void exportCsv("bilancio-verifica", () =>
                  toCsv(
                    [
                      { key: "code", label: "Codice" },
                      { key: "name", label: "Conto" },
                      { key: "debit", label: "Dare" },
                      { key: "credit", label: "Avere" },
                      { key: "balance", label: "Saldo" },
                    ],
                    d.tb.map((r) => ({
                      ...r,
                      debit: cents(r.debit),
                      credit: cents(r.credit),
                      balance: cents(r.balance),
                    })),
                  ),
                )
              }
            >
              Esporta CSV
            </Button>
          </Card>

          <Card title="Progetti">
            {d.projects.length === 0 ? (
              <p className="text-sm text-muted">Nessun progetto.</p>
            ) : (
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Progetto
                    </th>
                    {[
                      "Ore",
                      "Ore fatturabili",
                      "Valore fatturabile",
                      "Costo del lavoro",
                      "Budget",
                    ].map((h) => (
                      <th key={h} scope="col" className={`${TH} text-right`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.projects.map((p) => (
                    <tr key={p.projectId}>
                      <td className={TD}>{p.name}</td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {(p.minutes / 60).toFixed(1)}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {(p.billableMinutes / 60).toFixed(1)}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(p.billable)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(p.cost)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(p.budget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
