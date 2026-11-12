import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App";
import { testWorkspace } from "../../test/workspace";

// jsdom has no <dialog> modal support yet.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});

describe("CSV import dialog", () => {
  it("maps the columns, shows what will happen and creates the valid rows", async () => {
    const ws = await testWorkspace();
    window.location.hash = "#/e/party";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await user.click(await screen.findByRole("button", { name: "Importa CSV" }));
    const dialog = await screen.findByRole("dialog", { name: /Importa anagrafiche/i });
    const csv = [
      "Ragione sociale / Nome;Tipo;Email",
      "Acme Srl;Cliente;info@acme.it",
      "Beta;Cliente;beta@x.it",
      ";Cliente;senzanome@x.it",
    ].join("\n");
    const file = new File([csv], "clienti.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText("File CSV"), file);

    expect(await within(dialog).findByText("2 da importare")).toBeInTheDocument();
    expect(within(dialog).getByText("1 con errori")).toBeInTheDocument();
    expect(within(dialog).getByText(/Riga 4/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Importa 2 righe" }));
    expect(await within(dialog).findByText(/Importati/)).toBeInTheDocument();
    const stored = await ws.list("party", {});
    expect(stored.rows.map((r) => r["name"]).sort()).toEqual(["Acme Srl", "Beta"]);
  });
});

describe("duplicates page", () => {
  it("lists the groups and merges after confirmation", async () => {
    const ws = await testWorkspace();
    const keep = await ws.create("party", { name: "Acme S.r.l.", kind: "customer" });
    const drop = await ws.create("party", {
      name: "ACME srl",
      kind: "customer",
      email: "acme@example.com",
    });
    window.location.hash = "#/duplicates";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect(await screen.findByText("stesso nome")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Unisci in «Acme S\.r\.l\.»/ }));
    const confirm = await screen.findByRole("dialog", { name: "Unire le anagrafiche?" });
    await user.click(within(confirm).getByRole("button", { name: "Unisci" }));
    await waitFor(async () => expect(await ws.get("party", drop.id)).toBeNull());
    expect((await ws.get("party", keep.id))?.["email"]).toBe("acme@example.com");
    expect(await screen.findByText(/unita a «Acme S\.r\.l\.»/)).toBeInTheDocument();
  });
});
