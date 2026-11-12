import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App";
import { stockByWarehouse } from "../../modules/stock";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});

describe("inventory page", () => {
  it("receives into a warehouse, creates a lot on the fly and transfers", async () => {
    const ws = await testWorkspace();
    const product = await ws.create("product", {
      sku: "V-1",
      name: "Vite",
      kind: "goods",
      track_stock: true,
      track_lots: true,
      purchase_price: 1000,
    });
    const deposito = await ws.create("warehouse", { name: "Deposito" });
    window.location.hash = "#/inventory";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);

    const productSelect = await screen.findByLabelText("Prodotto");
    await waitFor(() =>
      expect(within(productSelect).getByRole("option", { name: /Vite/ })).toBeInTheDocument(),
    );
    await user.selectOptions(productSelect, product.id);
    await user.type(screen.getByLabelText("Quantità"), "10");
    await user.type(await screen.findByLabelText("Nuovo lotto"), "L-2026-01");
    await user.type(screen.getByLabelText("Scadenza del nuovo lotto"), "2027-01-31");
    await user.click(screen.getByRole("button", { name: "Registra" }));

    await waitFor(async () =>
      expect((await stockByWarehouse(ws.db))[0]).toMatchObject({
        onHand: 10,
        warehouse: "Magazzino principale",
      }),
    );
    expect(await screen.findByRole("link", { name: "L-2026-01" })).toBeInTheDocument();

    // choose the lot just created, then transfer 4 to the other warehouse
    const lotSelect = await screen.findByLabelText("Lotto");
    await waitFor(() =>
      expect(within(lotSelect).getByRole("option", { name: "L-2026-01" })).toBeInTheDocument(),
    );
    await user.selectOptions(
      lotSelect,
      within(lotSelect).getByRole("option", { name: "L-2026-01" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("A magazzino")).getByRole("option", { name: "Deposito" }),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText("A magazzino"), deposito.id);
    await user.type(screen.getByLabelText("Quantità da trasferire"), "4");
    await user.click(screen.getByRole("button", { name: "Trasferisci" }));

    expect(await screen.findByText("Trasferimento registrato.")).toBeInTheDocument();
    const rows = await stockByWarehouse(ws.db);
    expect(rows.find((r) => r.warehouseId === deposito.id)?.onHand).toBe(4);
    expect(rows.find((r) => r.warehouseId === null)?.onHand).toBe(6);
  });
});
