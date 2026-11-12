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

describe("VAT page", () => {
  it("shows the sales register and registers the settlement of the previous month", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2027-03-10T10:00:00Z"));
    const customer = await ws.create("party", { name: "Rossi Srl", kind: "customer" });
    const doc = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "invoice", date: "2027-02-10", party_id: customer.id },
        lines: [{ description: "x", quantity: 1, unit_price: 100000, vat_rate: 22 }],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, doc.id, "2027-02-10"));

    window.location.hash = "#/vat";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect((await screen.findAllByText("Rossi Srl")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Totale periodo/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Liquidazione" }));
    expect(await screen.findByText("Liquidazione mese 2 2027")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Registra la liquidazione" }));
    expect(await screen.findByText(/Liquidazione mese 2 2027 registrata/)).toBeInTheDocument();
    await waitFor(async () => expect((await ws.list("vat_settlement", {})).rows).toHaveLength(1));
    expect((await ws.list("vat_settlement", {})).rows[0]).toMatchObject({
      due: 22000,
      sales_vat: 22000,
    });
  });
});
