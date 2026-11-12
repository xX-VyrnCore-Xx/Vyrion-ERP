/**
 * Sample data for looking at the interface in a browser during development (`pnpm dev`, add
 * `?demo` to the address). It is never part of a production build: the call is guarded by
 * `import.meta.env.DEV`.
 */

import type { Workspace } from "../data/workspace";
import { addDays } from "../lib/dates";
import { saveCompany } from "../modules/company";
import { issueDocument, saveDocument } from "../modules/operations";

const NAMES = [
  "Rossi Impianti Srl",
  "Studio Bianchi",
  "Verdi Logistica Spa",
  "Ferrari Costruzioni",
  "Gamma Software",
  "Officine Neri",
  "Hotel Belvedere",
  "Conti & Figli",
];

export async function seedDemo(ws: Workspace): Promise<void> {
  const today = ws.ctx.today();
  await saveCompany(
    ws.db,
    {
      name: "VyrnCore Demo Srl",
      legal_form: "srl",
      regime: "ordinario",
      default_vat_rate: 22,
      vat_number: "01234567897",
    },
    ws.ctx.now(),
  );
  const parties = [];
  for (const name of NAMES) {
    parties.push(
      await ws.create("party", {
        name,
        kind: "customer",
        email: `info@${name.toLowerCase().replace(/[^a-z]/g, "")}.it`,
        payment_terms_days: 30,
      }),
    );
  }
  const supplier = await ws.create("party", { name: "Fornitore Energia Spa", kind: "supplier" });

  // twelve months of invoices, growing, a few unpaid and some long overdue
  for (let i = 0; i < 12; i++) {
    const date = addDays(today, -(11 - i) * 30 - 3);
    const count = 1 + (i % 3);
    for (let j = 0; j < count; j++) {
      const party = parties[(i + j * 3) % parties.length];
      if (!party) continue;
      const price = (900 + i * 140 + j * 350) * 100;
      const doc = await ws.transact((tx, ctx, repo) =>
        saveDocument(tx, ctx, repo, {
          header: { type: "invoice", date, party_id: party.id },
          lines: [
            {
              description: "Consulenza e assistenza",
              quantity: 1,
              unit_price: price,
              vat_rate: 22,
            },
          ],
        }),
      );
      const issued = await ws.transact((tx, ctx, repo) =>
        issueDocument(tx, ctx, repo, doc.id, date),
      );
      // older invoices are paid; the most recent and a few others stay open
      if (i < 8 || (i + j) % 4 === 0) {
        await ws.create("payment", {
          document_id: issued.id,
          date: addDays(date, 24),
          amount: Number(issued["payable"] ?? issued["total"]),
          method: "bank",
        });
      }
    }
  }
  const bill = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: {
        type: "purchase_invoice",
        number: "EN-4471",
        date: addDays(today, -20),
        party_id: supplier.id,
      },
      lines: [{ description: "Energia elettrica", quantity: 1, unit_price: 184000, vat_rate: 22 }],
    }),
  );
  await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, bill.id, addDays(today, -20)));

  const [stage] = (await ws.list("pipeline_stage", { limit: 10 })).rows.filter(
    (s) => s["kind"] === "open",
  );
  const first = parties[0];
  const second = parties[1];
  if (stage && first && second) {
    await ws.create("opportunity", {
      title: "Nuovo impianto sede Nord",
      party_id: first.id,
      stage_id: stage.id,
      amount: 1800000,
    });
    await ws.create("opportunity", {
      title: "Contratto di manutenzione",
      party_id: second.id,
      stage_id: stage.id,
      amount: 640000,
    });
    await ws.create("ticket", {
      party_id: first.id,
      subject: "Stampante di rete non risponde",
      priority: "high",
      status: "open",
    });
    await ws.create("ticket", {
      party_id: second.id,
      subject: "Richiesta nuovo account email",
      priority: "normal",
      status: "in_progress",
    });
    await ws.create("task", {
      title: "Richiamare Gamma Software per il rinnovo",
      status: "todo",
      priority: "high",
      party_id: parties[4]?.id ?? first.id,
    });
  }
  await ws.create("asset", {
    tag: "PC-001",
    name: "Portatile amministrazione",
    category: "laptop",
    status: "in_use",
  });
  await ws.create("asset", {
    tag: "SRV-001",
    name: "Server NAS uffici",
    category: "server",
    status: "in_use",
  });
}
