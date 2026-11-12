import { useState, type ChangeEvent } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatMoney } from "../lib/money";
import {
  autoMatch,
  candidatesFor,
  ignoreTransaction,
  importStatement,
  matchTransaction,
  readStatement,
  reconciliationSummary,
  unmatchTransaction,
  type MatchCandidate,
} from "../modules/bank";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay } from "../ui/format";

/** Match the lines of a bank statement with the payments recorded in the app. */
export function ReconciliationPage() {
  const ws = useWorkspace();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [show, setShow] = useState<"open" | "matched" | "ignored">("open");
  const data = useAsync(async () => {
    const rows = (
      await ws.list("bank_transaction", {
        filters: { status: show },
        limit: 300,
        orderBy: "date desc",
      })
    ).rows;
    const suggestions = new Map<string, MatchCandidate[]>();
    if (show === "open") for (const r of rows) suggestions.set(r.id, await candidatesFor(ws, r));
    return { rows, suggestions, summary: await reconciliationSummary(ws) };
  }, [show]);

  const attempt = async (job: () => Promise<string | undefined>) => {
    setMessage(null);
    try {
      const text = await job();
      if (text) setMessage({ ok: true, text });
      ws.touch();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await attempt(async () => {
      const read = readStatement(await file.text());
      const result = await importStatement(ws, read.lines);
      return `Importati ${result.created} movimenti${result.duplicates ? `, ${result.duplicates} già presenti` : ""}${read.problems.length ? `, ${read.problems.length} righe non leggibili (prima: riga ${read.problems[0]?.line}, ${read.problems[0]?.reason})` : ""}.`;
    });
    event.target.value = "";
  };

  const s = data.data?.summary;
  return (
    <>
      <PageHeader
        title="Riconciliazione bancaria"
        subtitle="Importa l'estratto conto (CSV della tua banca) e abbina ogni movimento a un pagamento registrato."
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
      <div className="space-y-4">
        <Card title="Estratto conto">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="Estratto conto CSV"
              onChange={(e) => void onFile(e)}
              className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-fg"
            />
            <Button
              onClick={() =>
                void attempt(
                  async () => `Abbinati automaticamente ${await autoMatch(ws)} movimenti.`,
                )
              }
            >
              Abbina i sicuri
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Colonne richieste: Data, Descrizione (o Causale) e Importo, oppure Dare e Avere.
            Importare di nuovo lo stesso file non crea doppioni.
          </p>
          {s ? (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Badge tone="warning">{s.open} da abbinare</Badge>
              <Badge tone="success">{s.matched} abbinati</Badge>
              <Badge>{s.ignored} ignorati</Badge>
              {s.paymentsWithoutLine > 0 ? (
                <Badge tone="info">{s.paymentsWithoutLine} pagamenti senza riga in banca</Badge>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card title="Movimenti">
          <div className="mb-3 flex gap-2" role="tablist" aria-label="Stato dei movimenti">
            {(["open", "matched", "ignored"] as const).map((k) => (
              <Button
                key={k}
                role="tab"
                aria-selected={show === k}
                variant={show === k ? "primary" : "secondary"}
                onClick={() => setShow(k)}
              >
                {k === "open" ? "Da abbinare" : k === "matched" ? "Abbinati" : "Ignorati"}
              </Button>
            ))}
          </div>
          {data.data && data.data.rows.length === 0 ? (
            <Empty>Nessun movimento in questo elenco.</Empty>
          ) : (
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Data
                  </th>
                  <th scope="col" className={TH}>
                    Descrizione
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Importo
                  </th>
                  <th scope="col" className={TH}>
                    Azione
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data?.rows.map((r) => {
                  const options = data.data?.suggestions.get(r.id) ?? [];
                  const best = options[0];
                  return (
                    <tr key={r.id}>
                      <td className={`${TD} whitespace-nowrap`}>{formatDay(String(r["date"]))}</td>
                      <td className={TD}>{String(r["description"])}</td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {formatMoney(Number(r["amount"]))}
                      </td>
                      <td className={TD}>
                        <div className="flex flex-wrap items-center gap-2">
                          {show === "open" ? (
                            <>
                              {best ? (
                                <Button
                                  variant="primary"
                                  title={best.reason}
                                  onClick={() =>
                                    void attempt(async () => {
                                      await matchTransaction(ws, r.id, best.paymentId);
                                      return undefined;
                                    })
                                  }
                                >
                                  Abbina a {best.documentNumber ?? best.party}
                                </Button>
                              ) : (
                                <span className="text-xs text-muted">
                                  Nessun pagamento corrispondente
                                </span>
                              )}
                              <Button
                                onClick={() =>
                                  void attempt(async () => {
                                    await ignoreTransaction(ws, r.id);
                                    return undefined;
                                  })
                                }
                              >
                                Ignora
                              </Button>
                            </>
                          ) : (
                            <Button
                              onClick={() =>
                                void attempt(async () => {
                                  await unmatchTransaction(ws, r.id);
                                  return undefined;
                                })
                              }
                            >
                              Rimetti da abbinare
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
