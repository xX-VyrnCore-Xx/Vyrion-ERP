import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});

describe("invoice in a foreign currency", () => {
  it("is written in USD, issued, and collected in USD with an exchange difference", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    const customer = await ws.create("party", { name: "Acme Inc", kind: "customer" });
    const user = userEvent.setup();
    window.location.hash = "#/d/invoice/new";
    render(<App preloaded={ws} />);

    await user.selectOptions(await screen.findByLabelText(/Anagrafica/), customer.id);
    await user.type(screen.getByLabelText("Descrizione riga 1"), "Consulenza");
    await user.type(screen.getByLabelText("Prezzo riga 1"), "1000,00");
    await user.clear(screen.getByLabelText("Valuta"));
    await user.type(screen.getByLabelText("Valuta"), "usd");
    await user.type(screen.getByLabelText("Cambio"), "1,1");
    // total in the currency, and its euro value
    expect((await screen.findAllByText(/1220,00 USD/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Controvalore in euro al cambio 1,1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Emetti" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    await user.click(within(dialog).getByRole("button", { name: "Emetti" }));
    await waitFor(async () =>
      expect((await ws.list("document", { filters: { status: "issued" } })).total).toBe(1),
    );
    const [invoice] = (await ws.list("document")).rows;
    expect(invoice).toMatchObject({ currency: "USD", total: 110909, foreign_total: 122000 });

    await user.type(await screen.findByLabelText("Euro effettivamente incassati"), "1120,00");
    await user.click(screen.getByRole("button", { name: "Registra" }));
    await waitFor(async () => expect((await ws.list("payment")).total).toBe(1));
    expect((await ws.list("payment")).rows[0]).toMatchObject({
      foreign_amount: 122000,
      amount: 110909,
      received: 112000,
    });
  });
});
