import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { centsToPlain, formatMoney, parseMoney } from "../lib/money";
import {
  billableTickets,
  billTicketHours,
  roundUp,
  type BillableTicket,
} from "../modules/ticketBilling";
import { Empty, ErrorNote } from "../ui/parts";

const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
const hours = (minutes: number): string => (minutes / 60).toFixed(2).replace(".", ",");

/** Hours worked on tickets that are not on an invoice yet, by customer. */
export function BillingHoursPage({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const [rates, setRates] = useState<Record<string, string>>({});
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const data = useAsync(() => billableTickets(ws), []);

  const byParty = new Map<string, BillableTicket[]>();
  for (const t of data.data ?? []) byParty.set(t.partyId, [...(byParty.get(t.partyId) ?? []), t]);

  const bill = async (partyId: string, fallbackRate: number | null) => {
    setMessage(null);
    const typed = rates[partyId];
    const rate = typed !== undefined ? parseMoney(typed) : fallbackRate;
    try {
      const invoice = await billTicketHours(ws, { partyId, rate: rate ?? 0, roundMinutes: step });
      ws.touch();
      go(href("d", "invoice", invoice.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Ore da fatturare"
        subtitle="Gli interventi sui ticket non ancora in fattura. Si crea una bozza di fattura per cliente, una riga per ticket."
      />
      <ErrorNote message={data.error ?? message} />
      <div className="mb-4 flex items-center gap-2 text-sm text-fg">
        <label htmlFor="round-step">Arrotonda ogni ticket per eccesso a</label>
        <select
          id="round-step"
          className={input}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        >
          <option value={1}>nessun arrotondamento</option>
          <option value={15}>15 minuti</option>
          <option value={30}>30 minuti</option>
          <option value={60}>1 ora</option>
        </select>
      </div>
      {data.data && data.data.length === 0 ? (
        <Empty>Nessuna ora da fatturare: tutti gli interventi sono già in fattura.</Empty>
      ) : (
        <div className="space-y-4">
          {[...byParty.entries()].map(([partyId, tickets]) => {
            const first = tickets[0] as BillableTicket;
            const rate =
              rates[partyId] ?? (first.hourlyRate !== null ? centsToPlain(first.hourlyRate) : "");
            const cents = parseMoney(rate);
            const total = tickets.reduce((s, t) => s + roundUp(t.minutes, step), 0);
            return (
              <Card key={partyId} title={first.party}>
                <ul className="mb-3 divide-y divide-line/60 text-sm">
                  {tickets.map((t) => (
                    <li key={t.ticketId} className="flex justify-between gap-3 py-1.5">
                      <a
                        className="text-fg hover:text-accent"
                        href={href("e", "ticket", t.ticketId)}
                      >
                        {t.number} · {t.subject}
                      </a>
                      <span className="tabular-nums text-muted">
                        {t.interventions} interventi · {hours(roundUp(t.minutes, step))} h
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 text-fg">
                    Tariffa oraria €
                    <input
                      aria-label={`Tariffa oraria per ${first.party}`}
                      inputMode="decimal"
                      className={`${input} w-28`}
                      value={rate}
                      onChange={(e) => setRates({ ...rates, [partyId]: e.target.value })}
                    />
                  </label>
                  <span className="text-muted">
                    {hours(total)} h
                    {cents ? ` · ${formatMoney(Math.round((total / 60) * cents))} + IVA` : ""}
                  </span>
                  <Button
                    variant="primary"
                    disabled={!cents}
                    onClick={() => void bill(partyId, first.hourlyRate)}
                  >
                    Crea bozza di fattura
                  </Button>
                </div>
                {first.hourlyRate === null ? (
                  <p className="mt-2 text-xs text-muted">
                    Puoi salvare la tariffa nella scheda del cliente («Tariffa oraria») per non
                    riscriverla.
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
