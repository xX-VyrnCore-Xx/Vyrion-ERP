/**
 * Billing the hours worked on support tickets: the interventions of a customer's tickets that
 * are not yet on an invoice become the lines of a new draft invoice (one line per ticket,
 * quantity in hours), and are marked so they cannot be billed twice.
 */

import type { Rec } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import type { Workspace } from "../data/workspace";
import { formatDay } from "../ui/format";
import { getCompany } from "./company";
import { saveDocument } from "./operations";

export interface BillableTicket {
  ticketId: string;
  number: string;
  subject: string;
  partyId: string;
  party: string;
  minutes: number;
  interventions: number;
  /** The customer's hourly rate in cents, if set on the customer. */
  hourlyRate: number | null;
}

/** Tickets that have interventions not yet billed. */
export async function billableTickets(ws: Workspace): Promise<BillableTicket[]> {
  const rows = (await ws.db.query(
    `SELECT t.id, t.number, t.subject, t.party_id, p.name AS party, p.hourly_rate,
            SUM(i.minutes) AS minutes, COUNT(*) AS n
     FROM ticket_interventions i
     JOIN tickets t ON t.id = i.ticket_id
     JOIN parties p ON p.id = t.party_id
     WHERE i.deleted_at IS NULL AND i.document_id IS NULL AND t.deleted_at IS NULL
     GROUP BY t.id ORDER BY p.name, t.number`,
  )) as unknown as {
    id: string;
    number: string;
    subject: string;
    party_id: string;
    party: string;
    hourly_rate: number | null;
    minutes: number;
    n: number;
  }[];
  return rows.map((r) => ({
    ticketId: r.id,
    number: r.number,
    subject: r.subject,
    partyId: r.party_id,
    party: r.party,
    minutes: Number(r.minutes),
    interventions: Number(r.n),
    hourlyRate: r.hourly_rate === null ? null : Number(r.hourly_rate),
  }));
}

export interface BillOptions {
  partyId: string;
  /** Cents per hour. */
  rate: number;
  /** Round each ticket's time up to a multiple of this many minutes (1 = exact). */
  roundMinutes?: number;
  /** Only these tickets (default: all of the customer's billable tickets). */
  ticketIds?: string[];
  vatRate?: number;
  date?: string;
}

export const roundUp = (minutes: number, step: number): number =>
  step <= 1 ? minutes : Math.ceil(minutes / step) * step;

/** Creates the draft invoice and marks the interventions as billed. Returns the document. */
export async function billTicketHours(ws: Workspace, options: BillOptions): Promise<Rec> {
  if (!Number.isInteger(options.rate) || options.rate <= 0)
    throw new ValidationError({ rate: "Indica la tariffa oraria" });
  const step = options.roundMinutes ?? 1;
  return ws.transact(async (tx, ctx, repo) => {
    const company = await getCompany(tx);
    const tickets = (await tx.query(
      `SELECT DISTINCT t.id, t.number, t.subject FROM tickets t
       JOIN ticket_interventions i ON i.ticket_id = t.id AND i.deleted_at IS NULL AND i.document_id IS NULL
       WHERE t.deleted_at IS NULL AND t.party_id = ? ORDER BY t.number`,
      [options.partyId],
    )) as unknown as { id: string; number: string; subject: string }[];
    const chosen = options.ticketIds
      ? tickets.filter((t) => options.ticketIds?.includes(t.id))
      : tickets;
    if (chosen.length === 0)
      throw new ConflictError("Non ci sono ore da fatturare per questo cliente");

    const lines = [];
    const billed: string[] = [];
    for (const t of chosen) {
      const items = (await tx.query(
        "SELECT id, minutes, performed_on FROM ticket_interventions WHERE ticket_id = ? AND deleted_at IS NULL AND document_id IS NULL ORDER BY performed_on",
        [t.id],
      )) as unknown as { id: string; minutes: number; performed_on: string }[];
      const minutes = roundUp(
        items.reduce((s, i) => s + Number(i.minutes), 0),
        step,
      );
      const first = items[0]?.performed_on;
      const last = items[items.length - 1]?.performed_on;
      lines.push({
        description: `Assistenza ${t.number} – ${t.subject} (${first === last ? formatDay(first ?? "") : `${formatDay(first ?? "")} – ${formatDay(last ?? "")}`})`,
        quantity: Math.round((minutes / 60) * 100) / 100,
        unit: "h",
        unit_price: options.rate,
        vat_rate: options.vatRate ?? company?.default_vat_rate ?? 22,
      });
      billed.push(...items.map((i) => i.id));
    }
    const invoice = await saveDocument(tx, ctx, repo, {
      header: {
        type: "invoice",
        date: options.date ?? ctx.today(),
        party_id: options.partyId,
        notes: "Ore di assistenza",
      },
      lines,
    });
    for (const id of billed)
      await repo("ticket_intervention").update(tx, ctx, id, { document_id: invoice.id });
    return invoice;
  });
}
