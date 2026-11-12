import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatMoney } from "../lib/money";
import { toCsv } from "../modules/reports";
import {
  computeSettlement,
  historicalAdvance,
  periodRange,
  registerSettlement,
  vatRegister,
  type Periodicity,
  type Register,
} from "../modules/vat";
import { Badge, ConfirmDialog, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay } from "../ui/format";
import { saveText } from "../ui/saveText";

const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
const cents = (n: number) => n / 100;
type Tab = Register | "settlement";

/** VAT registers (sales, purchases) and the periodic settlement. */
export function VatPage() {
  const ws = useWorkspace();
  const thisYear = Number(ws.ctx.today().slice(0, 4));
  const [kind, setKind] = useState<Periodicity>("monthly");
  const [year, setYear] = useState(thisYear);
  const [period, setPeriod] = useState(
    Math.max(1, Math.ceil(Number(ws.ctx.today().slice(5, 7)) / (kind === "monthly" ? 1 : 3)) - 1) ||
      1,
  );
  const [tab, setTab] = useState<Tab>("sales");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  const maxPeriod = kind === "monthly" ? 12 : 4;
  const safePeriod = Math.min(Math.max(1, period), maxPeriod);
  const range = periodRange(year, kind, safePeriod);

  const data = useAsync(async () => {
    const settlement = await computeSettlement(ws.db, year, kind, safePeriod);
    const register =
      tab === "settlement" ? null : await vatRegister(ws.db, range.from, range.to, tab);
    const registered = (await ws.list("vat_settlement", { limit: 50, orderBy: "date_to desc" }))
      .rows;
    return {
      settlement,
      register,
      registered,
      advance: await historicalAdvance(ws.db, year, kind),
    };
  }, [year, kind, safePeriod, tab]);

  const attempt = async (job: () => Promise<string>) => {
    setMessage(null);
    try {
      setMessage({ ok: true, text: await job() });
      ws.touch();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const d = data.data;
  const s = d?.settlement;
  const label = (n: number) => (kind === "monthly" ? `mese ${n}` : `trimestre ${n}`);
  return (
    <>
      <PageHeader
        title="Registri IVA e liquidazione"
        subtitle="Registri delle vendite e degli acquisti e liquidazione periodica, dai documenti emessi. Strumento di lavoro: non invia nulla e va verificato dal commercialista."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-fg">
        <label className="flex items-center gap-2">
          Periodicità
          <select
            aria-label="Periodicità"
            className={input}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Periodicity);
              setPeriod(1);
            }}
          >
            <option value="monthly">Mensile</option>
            <option value="quarterly">Trimestrale</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Anno
          <input
            type="number"
            aria-label="Anno"
            className={`${input} w-24`}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          {kind === "monthly" ? "Mese" : "Trimestre"}
          <input
            type="number"
            aria-label="Periodo"
            min={1}
            max={maxPeriod}
            className={`${input} w-20`}
            value={safePeriod}
            onChange={(e) => setPeriod(Number(e.target.value))}
          />
        </label>
        <span className="text-muted">
          {formatDay(range.from)} – {formatDay(range.to)}
        </span>
      </div>
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Sezioni">
        {(
          [
            ["sales", "Registro vendite"],
            ["purchases", "Registro acquisti"],
            ["settlement", "Liquidazione"],
          ] as const
        ).map(([key, name]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {name}
          </Button>
        ))}
      </div>
      <ErrorNote message={data.error} />
      {message ? (
        message.ok ? (
          <p role="status" className="mb-4 text-sm text-success">
            {message.text}
          </p>
        ) : (
          <div className="mb-4">
            <ErrorNote message={message.text} />
          </div>
        )
      ) : null}

      {d?.register ? (
        <Card title={tab === "sales" ? "Registro delle vendite" : "Registro degli acquisti"}>
          {d.register.lines.length === 0 ? (
            <Empty>Nessun documento emesso in questo periodo.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    {tab === "purchases" ? (
                      <th scope="col" className={TH}>
                        Prot.
                      </th>
                    ) : null}
                    {["Data", "Numero", "Controparte", "P.IVA", "Aliquota"].map((h) => (
                      <th key={h} scope="col" className={TH}>
                        {h}
                      </th>
                    ))}
                    {["Imponibile", "IVA"].map((h) => (
                      <th key={h} scope="col" className={`${TH} text-right`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.register.lines.map((l, i) => (
                    <tr key={`${l.documentId}-${i}`} className={l.split ? "opacity-60" : ""}>
                      {tab === "purchases" ? <td className={TD}>{l.protocol}</td> : null}
                      <td className={`${TD} whitespace-nowrap`}>{formatDay(l.date)}</td>
                      <td className={TD}>{l.number}</td>
                      <td className={TD}>{l.party}</td>
                      <td className={TD}>{l.vatNumber ?? "—"}</td>
                      <td className={TD}>
                        {l.rate > 0 ? `${l.rate}%` : (l.nature ?? "esente")}
                        {l.split ? " · split" : ""}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(l.base)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(l.vat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 space-y-1 text-sm">
            {d.register.totals.byRate.map((t) => (
              <div key={`${t.rate}|${t.nature}`} className="flex justify-between gap-4">
                <span className="text-muted">
                  Totale {t.rate > 0 ? `${t.rate}%` : (t.nature ?? "esente")}
                </span>
                <span className="tabular-nums text-fg">
                  {formatMoney(t.base)} · IVA {formatMoney(t.vat)}
                </span>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold text-fg">
              <span>Totale periodo</span>
              <span className="tabular-nums">
                {formatMoney(d.register.totals.base)} · IVA {formatMoney(d.register.totals.vat)}
              </span>
            </div>
            {d.register.splitVat !== 0 ? (
              <p className="text-xs text-muted">
                IVA in split payment ({formatMoney(d.register.splitVat)}): elencata ma non inclusa
                nei totali, la versa l'ente.
              </p>
            ) : null}
          </div>
          <Button
            className="mt-3"
            onClick={() =>
              void attempt(async () => {
                const rows = d.register?.lines ?? [];
                await saveText(
                  `registro-${tab === "sales" ? "vendite" : "acquisti"}_${range.from}_${range.to}.csv`,
                  toCsv(
                    [
                      { key: "protocol", label: "Protocollo" },
                      { key: "date", label: "Data" },
                      { key: "number", label: "Numero" },
                      { key: "party", label: "Controparte" },
                      { key: "vatNumber", label: "Partita IVA" },
                      { key: "rate", label: "Aliquota" },
                      { key: "nature", label: "Natura" },
                      { key: "base", label: "Imponibile" },
                      { key: "vat", label: "IVA" },
                      { key: "split", label: "Split payment" },
                    ],
                    rows.map((l) => ({
                      protocol: l.protocol ?? "",
                      date: l.date,
                      number: l.number,
                      party: l.party,
                      vatNumber: l.vatNumber ?? "",
                      rate: l.rate,
                      nature: l.nature ?? "",
                      base: cents(l.base),
                      vat: cents(l.vat),
                      split: l.split ? "sì" : "",
                    })),
                  ),
                );
                return "Registro esportato.";
              })
            }
          >
            Esporta CSV
          </Button>
        </Card>
      ) : null}

      {tab === "settlement" && s ? (
        <div className="space-y-4">
          <Card title={`Liquidazione ${label(s.period)} ${s.year}`}>
            <dl className="grid max-w-lg grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-muted">IVA sulle vendite</dt>
              <dd className="text-right tabular-nums">{formatMoney(s.salesVat)}</dd>
              <dt className="text-muted">IVA sugli acquisti</dt>
              <dd className="text-right tabular-nums">− {formatMoney(s.purchasesVat)}</dd>
              {s.previousCredit > 0 ? (
                <>
                  <dt className="text-muted">Credito del periodo precedente</dt>
                  <dd className="text-right tabular-nums">− {formatMoney(s.previousCredit)}</dd>
                </>
              ) : null}
              {s.previousDebit > 0 ? (
                <>
                  <dt className="text-muted">Debito precedente riportato (sotto € 25,82)</dt>
                  <dd className="text-right tabular-nums">+ {formatMoney(s.previousDebit)}</dd>
                </>
              ) : null}
              <dt className="font-medium text-fg">
                {s.balance >= 0 ? "IVA a debito" : "IVA a credito"}
              </dt>
              <dd className="text-right font-medium tabular-nums text-fg">
                {formatMoney(Math.abs(s.balance))}
              </dd>
              {s.interest > 0 ? (
                <>
                  <dt className="text-muted">Interessi trimestrali 1%</dt>
                  <dd className="text-right tabular-nums">+ {formatMoney(s.interest)}</dd>
                </>
              ) : null}
              <dt className="font-semibold text-fg">Da versare</dt>
              <dd className="text-right text-lg font-semibold tabular-nums text-fg">
                {formatMoney(s.due)}
              </dd>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {s.due > 0 ? <Badge tone="warning">Scadenza {formatDay(s.payBy)}</Badge> : null}
              {s.creditForward > 0 ? (
                <Badge tone="info">Credito da riportare {formatMoney(s.creditForward)}</Badge>
              ) : null}
              {s.debitForward > 0 ? (
                <Badge>Debito riportato {formatMoney(s.debitForward)}</Badge>
              ) : null}
              {s.registeredId ? <Badge tone="success">Registrata</Badge> : null}
              {s.missingPrevious ? (
                <Badge tone="danger">Registra prima il periodo precedente</Badge>
              ) : null}
            </div>
            <Button
              className="mt-4"
              variant="primary"
              disabled={Boolean(s.registeredId) || s.missingPrevious}
              onClick={() =>
                void attempt(async () => {
                  await registerSettlement(ws, year, kind, safePeriod);
                  return `Liquidazione ${label(safePeriod)} ${year} registrata in prima nota.`;
                })
              }
            >
              Registra la liquidazione
            </Button>
            <p className="mt-3 text-xs text-muted">
              Registrando si chiudono in prima nota l'IVA a debito e a credito del periodo, con la
              differenza su «Erario c/IVA». Gli interessi non si registrano qui: vanno col
              versamento. Regole generali (soglia di € 25,82, interessi 1% sui trimestri 1–3): fai
              confermare dal commercialista che valgano per te.
            </p>
          </Card>

          {d && d.advance.base > 0 ? (
            <Card title={`Acconto IVA di dicembre ${year} (metodo storico)`}>
              <p className="text-sm text-fg">
                88% di {formatMoney(d.advance.base)} ={" "}
                <strong className="tabular-nums">{formatMoney(d.advance.advance)}</strong>
                {d.advance.due
                  ? " da versare entro il 27 dicembre."
                  : " (sotto € 103,29: non dovuto)."}
              </p>
            </Card>
          ) : null}

          <Card title="Liquidazioni registrate">
            {d && d.registered.length === 0 ? (
              <Empty>Nessuna liquidazione registrata.</Empty>
            ) : (
              <ul className="divide-y divide-line/60 text-sm">
                {d?.registered.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span className="text-fg">
                      {String(r["period_kind"]) === "monthly" ? "Mese" : "Trimestre"}{" "}
                      {String(r["period"])}/{String(r["year"])}
                    </span>
                    <span className="flex items-center gap-3 text-muted">
                      <span className="tabular-nums">
                        da versare {formatMoney(Number(r["due"]))}
                      </span>
                      <Button onClick={() => setUndo(r.id)}>Annulla</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {undo ? (
        <ConfirmDialog
          title="Annullare la liquidazione?"
          message="Viene stornata la scrittura in prima nota e il credito o debito riportato torna al periodo precedente."
          confirmLabel="Annulla liquidazione"
          onCancel={() => setUndo(null)}
          onConfirm={() => {
            const id = undo;
            setUndo(null);
            void attempt(async () => {
              await ws.remove("vat_settlement", id);
              return "Liquidazione annullata.";
            });
          }}
        />
      ) : null}
    </>
  );
}
