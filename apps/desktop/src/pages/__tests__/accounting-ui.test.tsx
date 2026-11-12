import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App";
import { periodStatus } from "../../modules/periods";
import { issueDocument, saveDocument } from "../../modules/operations";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});

const clock = () => new Date("2027-03-10T10:00:00Z");

async function withInvoice() {
  const ws = await testWorkspace("ordinario", clock);
  const customer = await ws.create("party", { name: "Rossi Srl", kind: "customer" });
  const doc = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: { type: "invoice", date: "2026-04-01", party_id: customer.id },
      lines: [{ description: "Servizio", quantity: 1, unit_price: 100000, vat_rate: 22 }],
    }),
  );
  const issued = await ws.transact((tx, ctx, repo) =>
    issueDocument(tx, ctx, repo, doc.id, "2026-04-01"),
  );
  return { ws, issued };
}

describe("accounting pages", () => {
  it("closes the year from the closing page", async () => {
    const { ws } = await withInvoice();
    window.location.hash = "#/closing";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await user.click(await screen.findByRole("button", { name: "Chiudi l'esercizio 2026" }));
    const dialog = await screen.findByRole("dialog", { name: "Chiudere l'esercizio 2026?" });
    await user.click(within(dialog).getByRole("button", { name: "Chiudi" }));
    expect(await screen.findByText(/Esercizio 2026 chiuso: utile di/)).toBeInTheDocument();
    expect((await periodStatus(ws.db)).closedThrough).toBe("2026-12-31");
    expect(await screen.findByText("Quadra")).toBeInTheDocument();
  });

  it("posts a year of depreciation from the fixed assets page", async () => {
    const ws = await testWorkspace("ordinario", clock);
    await ws.create("fixed_asset", {
      name: "Server",
      category: "electronics",
      purchase_date: "2026-03-01",
      cost: 200000,
      rate: 20,
    });
    window.location.hash = "#/fixed-assets";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect((await screen.findAllByText("Server")).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole("button", { name: "Registra l'ammortamento 2026" }));
    expect(await screen.findByText(/Registrato l'ammortamento 2026/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Registrato").length).toBeGreaterThan(0));
  });

  it("imports a statement and matches a line to its payment", async () => {
    const { ws, issued } = await withInvoice();
    await ws.create("payment", {
      document_id: issued.id,
      date: "2026-04-12",
      amount: 122000,
      method: "bank",
    });
    window.location.hash = "#/reconciliation";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    const csv = `Data;Descrizione;Importo\n12/04/2026;Bonifico Rossi ${String(issued["number"])};1.220,00`;
    await user.upload(
      await screen.findByLabelText("Estratto conto CSV"),
      new File([csv], "estratto.csv", { type: "text/csv" }),
    );
    expect(await screen.findByText(/Importati 1 movimenti/)).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(`Abbina a ${String(issued["number"])}`),
      }),
    );
    await waitFor(async () =>
      expect((await ws.list("bank_transaction", { limit: 5 })).rows[0]?.["status"]).toBe("matched"),
    );
  });
});
