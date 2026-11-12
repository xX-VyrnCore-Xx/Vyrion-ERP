import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatMoney } from "../lib/money";
import { balanceSheet, closeYear, periodStatus, reopenYear, yearResult } from "../modules/periods";
import { Badge, ConfirmDialog, Empty, ErrorNote } from "../ui/parts";
import { formatDay, formatInstant } from "../ui/format";

type Action = { kind: "close" | "reopen"; year: number };

/** Year-end closing: lock a finished year and move its result to equity; plus a management balance sheet. */
export function ClosingPage() {
  const ws = useWorkspace();
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const today = ws.ctx.today();
  const data = useAsync(async () => {
    const status = await periodStatus(ws.db);
    const last = status.closings[status.closings.length - 1];
    const next = last ? last.year + 1 : null;
    // The first year to close is the earliest one with entries, when none was closed yet.
    const [first] = await ws.db.query<{ y: string | null }>(
      "SELECT MIN(substr(date, 1, 4)) AS y FROM journal_entries",
    );
    const candidate = next ?? (first?.y ? Number(first.y) : null);
    const ended = candidate !== null && today > `${candidate}-12-31`;
    return {
      status,
      candidate,
      ended,
      preview: candidate !== null ? await yearResult(ws.db, candidate) : 0,
      sheet: await balanceSheet(ws.db, today),
    };
  }, []);

  const run = async () => {
    if (!action) return;
    const current = action;
    setAction(null);
    setMessage(null);
    try {
      if (current.kind === "close") {
        const record = await closeYear(ws, current.year);
        setMessage({
          ok: true,
          text: `Esercizio ${current.year} chiuso: ${record.result >= 0 ? "utile" : "perdita"} di ${formatMoney(Math.abs(record.result))}.`,
        });
      } else {
        await reopenYear(ws, current.year);
        setMessage({ ok: true, text: `Esercizio ${current.year} riaperto.` });
      }
      ws.touch();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const d = data.data;
  const last = d?.status.closings[d.status.closings.length - 1];
  return (
    <>
      <PageHeader
        title="Chiusura dell'esercizio"
        subtitle="Chiudere un anno sposta l'utile o la perdita nel patrimonio netto e blocca le registrazioni con date di quell'anno."
      />
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
      {d ? (
        <div className="space-y-4">
          <Card title="Stato">
            <p className="mb-3 text-sm text-muted">
              {d.status.closedThrough
                ? `Esercizi chiusi fino al ${formatDay(d.status.closedThrough)}.`
                : "Nessun esercizio chiuso."}
            </p>
            {d.candidate === null ? (
              <Empty>Non ci sono ancora registrazioni in prima nota.</Empty>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-fg">
                  Esercizio <strong>{d.candidate}</strong>: {d.preview >= 0 ? "utile" : "perdita"}{" "}
                  {formatMoney(Math.abs(d.preview))}
                </span>
                {d.ended ? (
                  <Button
                    variant="primary"
                    onClick={() => setAction({ kind: "close", year: d.candidate as number })}
                  >
                    Chiudi l'esercizio {d.candidate}
                  </Button>
                ) : (
                  <Badge tone="info">Non ancora terminato</Badge>
                )}
              </div>
            )}
            {last ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
                <span className="text-muted">
                  Ultimo chiuso: {last.year} ({formatInstant(last.closedAt)}), risultato{" "}
                  {formatMoney(last.result)}
                </span>
                <Button onClick={() => setAction({ kind: "reopen", year: last.year })}>
                  Riapri l'esercizio {last.year}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card title={`Stato patrimoniale gestionale al ${formatDay(d.sheet.asOf)}`}>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between">
                <dt className="text-muted">Attività</dt>
                <dd className="tabular-nums text-fg">{formatMoney(d.sheet.assets)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Passività</dt>
                <dd className="tabular-nums text-fg">{formatMoney(d.sheet.liabilities)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Patrimonio netto</dt>
                <dd className="tabular-nums text-fg">{formatMoney(d.sheet.equity)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Risultato non ancora chiuso</dt>
                <dd className="tabular-nums text-fg">{formatMoney(d.sheet.openResult)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm">
              {d.sheet.difference === 0 ? (
                <Badge tone="success">Quadra</Badge>
              ) : (
                <Badge tone="danger">Non quadra di {formatMoney(d.sheet.difference)}</Badge>
              )}
            </p>
            <p className="mt-3 text-xs text-muted">
              Documento gestionale ricavato dalla prima nota: non è il bilancio civilistico (schema
              del Codice civile), che resta di competenza del commercialista.
            </p>
          </Card>
        </div>
      ) : null}
      {action ? (
        <ConfirmDialog
          title={
            action.kind === "close"
              ? `Chiudere l'esercizio ${action.year}?`
              : `Riaprire l'esercizio ${action.year}?`
          }
          message={
            action.kind === "close"
              ? "Il risultato passa nel patrimonio netto e non si potranno più registrare movimenti con date dell'anno. Potrai riaprirlo finché è l'ultimo chiuso."
              : "Viene stornata la scrittura di chiusura e si tornano a poter registrare movimenti dell'anno."
          }
          confirmLabel={action.kind === "close" ? "Chiudi" : "Riapri"}
          onCancel={() => setAction(null)}
          onConfirm={() => void run()}
        />
      ) : null}
    </>
  );
}
