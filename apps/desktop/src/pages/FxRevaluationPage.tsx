import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatCurrency, formatMoney } from "../lib/money";
import { registerRevaluation, revaluationPreview } from "../modules/fxRevaluation";
import { Badge, ConfirmDialog, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";

const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";

const parseRate = (text: string | undefined): number | undefined => {
  const n = Number((text ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Year-end adjustment of foreign-currency receivables and payables. */
export function FxRevaluationPage() {
  const ws = useWorkspace();
  const [year, setYear] = useState(Number(ws.ctx.today().slice(0, 4)) - 1);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  const parsed = Object.fromEntries(Object.entries(rates).map(([c, t]) => [c, parseRate(t)]));
  const data = useAsync(async () => {
    const currencies = await revaluationPreview(ws.db, year, parsed);
    const registered = (await ws.list("fx_revaluation", { limit: 100, orderBy: "year desc" })).rows;
    return { currencies, registered };
  }, [year, JSON.stringify(parsed)]);

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
  const ready = (d?.currencies ?? []).filter((c) => c.rate && !c.registeredId);
  return (
    <>
      <PageHeader
        title="Adeguamento cambi a fine anno"
        subtitle="Crediti e debiti in valuta ancora aperti al 31 dicembre, valutati al cambio di fine anno. Strumento di lavoro: il trattamento fiscale va confermato dal commercialista."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-fg">
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

      {d && d.currencies.length === 0 ? (
        <Card title={`Posizioni in valuta al 31/12/${year}`}>
          <Empty>Nessun credito o debito in valuta estera ancora aperto a fine anno.</Empty>
        </Card>
      ) : null}

      <div className="space-y-4">
        {(d?.currencies ?? []).map((c) => (
          <Card key={c.currency} title={`${c.currency} · posizioni al 31/12/${year}`}>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-fg">
              <label className="flex items-center gap-2">
                Cambio al 31/12 ({c.currency} per 1 EUR)
                <input
                  aria-label={`Cambio ${c.currency}`}
                  className={`${input} w-28`}
                  inputMode="decimal"
                  placeholder="es. 1,2000"
                  disabled={Boolean(c.registeredId)}
                  value={rates[c.currency] ?? ""}
                  onChange={(e) => setRates((r) => ({ ...r, [c.currency]: e.target.value }))}
                />
              </label>
              {c.registeredId ? <Badge tone="success">Già registrato</Badge> : null}
            </div>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    {["Documento", "Controparte", "Lato"].map((h) => (
                      <th key={h} scope="col" className={TH}>
                        {h}
                      </th>
                    ))}
                    {["Aperto in valuta", "Valore in libro", "Al cambio", "Differenza"].map((h) => (
                      <th key={h} scope="col" className={`${TH} text-right`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((i) => (
                    <tr key={i.documentId}>
                      <td className={TD}>{i.number}</td>
                      <td className={TD}>{i.party}</td>
                      <td className={TD}>{i.side === "receivable" ? "Credito" : "Debito"}</td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {formatCurrency(i.foreignOpen, i.currency)}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(i.carrying)}</td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {c.rate ? formatMoney(i.revalued) : "—"}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {c.rate ? formatMoney(i.difference) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {c.rate ? (
              <p className="mt-3 text-sm text-fg">
                Utili da valutazione <span className="tabular-nums">{formatMoney(c.gain)}</span> ·
                perdite <span className="tabular-nums">{formatMoney(c.loss)}</span>
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted">Indica il cambio per vedere le differenze.</p>
            )}
          </Card>
        ))}
      </div>

      {ready.length > 0 ? (
        <div className="mt-4">
          <Button
            variant="primary"
            onClick={() =>
              void attempt(async () => {
                const done = await registerRevaluation(ws, year, parsed);
                return `Adeguamento ${year} registrato (${done.length} ${done.length === 1 ? "valuta" : "valute"}): scrittura al 31/12 e storno all'1/1.`;
              })
            }
          >
            Registra l'adeguamento
          </Button>
          <p className="mt-2 text-xs text-muted">
            Registra una scrittura al 31 dicembre (utili e perdite su cambi da valutazione) e il suo
            storno all'1 gennaio, così l'incasso o il pagamento dell'anno dopo trova il documento al
            cambio originale. Va fatto <strong>prima di chiudere l'esercizio</strong>.
          </p>
        </div>
      ) : null}

      {d && d.registered.length > 0 ? (
        <Card title="Adeguamenti registrati">
          <ul className="space-y-1 text-sm">
            {d.registered.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>
                  {String(r["year"])} · {String(r["currency"])} · cambio{" "}
                  {String(r["rate"]).replace(".", ",")} · utili {formatMoney(Number(r["gain"]))} ·
                  perdite {formatMoney(Number(r["loss"]))}
                </span>
                <Button
                  aria-label={`Annulla l'adeguamento ${String(r["currency"])} ${String(r["year"])}`}
                  onClick={() => setUndo(r.id)}
                >
                  Annulla
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {undo ? (
        <ConfirmDialog
          title="Annullare l'adeguamento?"
          message="Vengono stornate la scrittura al 31 dicembre e quella dell'1 gennaio. Potrai registrarlo di nuovo."
          confirmLabel="Annulla adeguamento"
          onCancel={() => setUndo(null)}
          onConfirm={() => {
            const id = undo;
            setUndo(null);
            void attempt(async () => {
              await ws.remove("fx_revaluation", id);
              return "Adeguamento annullato.";
            });
          }}
        />
      ) : null}
    </>
  );
}
