import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App";
import { issueDocument, saveDocument } from "../../modules/operations";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});

describe("year-end adjustment page", () => {
  it("shows the differences at the rate and registers the adjustment", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2027-01-10T10:00:00Z"));
    const customer = await ws.create("party", { name: "Acme Inc", kind: "customer" });
    const doc = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: {
          type: "invoice",
          date: "2026-04-01",
          party_id: customer.id,
          currency: "USD",
          exchange_rate: 1.1,
        },
        lines: [{ description: "x", quantity: 1, unit_price: 100000, vat_rate: 22 }],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, doc.id, "2026-04-01"));

    window.location.hash = "#/fx-revaluation";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect(await screen.findByText(/USD · posizioni al 31\/12\/2026/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Cambio USD"), "1,2");
    // 1.220,00 USD valued 1.016,67 € against 1.109,09 € in the books: a loss of 92,42 €
    expect((await screen.findAllByText(/Utili da valutazione/)).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole("button", { name: "Registra l'adeguamento" }));
    expect(await screen.findByText(/Adeguamento 2026 registrato/)).toBeInTheDocument();
    await waitFor(async () =>
      expect((await ws.list("fx_revaluation", {})).rows[0]).toMatchObject({
        currency: "USD",
        loss: 9242,
        gain: 0,
      }),
    );
  });
});
