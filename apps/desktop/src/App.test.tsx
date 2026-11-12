import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { openMemoryDatabase } from "./data/memoryDriver";
import { Workspace } from "./data/workspace";
import { ALL_ENTITIES, businessMigrations } from "./modules";
import { seedDefaults } from "./modules/seed";
import { testWorkspace } from "./test/workspace";

// jsdom has no <dialog> modal support yet.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});

const READY = {
  status: "ok",
  version: "9.9.9",
  components: { database: { status: "ok", latency_ms: 2 }, redis: { status: "ok", latency_ms: 1 } },
};

/** Opens the account menu at the bottom of the sidebar and picks an entry. */
async function openSettings(user: ReturnType<typeof userEvent.setup>, entry: string) {
  await user.click(await screen.findByRole("button", { name: /^Account e profilo/ }));
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(entry) }));
}

const companyForm = (): HTMLElement => {
  const form = screen.getByLabelText(/Ragione sociale/).closest("form");
  if (!form) throw new Error("company form not found");
  return form;
};

describe("first run", () => {
  it("asks for the company data and then shows the overview, with no network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const wasm = dirname(createRequire(import.meta.url).resolve("sql.js"));
    const db = await openMemoryDatabase((f) => join(wasm, f));
    const ws = await Workspace.open({ db, entities: ALL_ENTITIES, migrations: businessMigrations });
    await seedDefaults(ws);

    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect(await screen.findByText(/Puoi usare subito tutti i moduli/)).toBeInTheDocument();
    expect(screen.getAllByText("Solo locale").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Completa ora" }));
    await user.type(await screen.findByLabelText(/Ragione sociale/), "VyrnCore Srl");
    await user.type(screen.getByLabelText(/Partita IVA/), "12345678901"); // wrong checksum
    await user.click(
      within(companyForm()).getByRole("button", {
        name: "Salva",
      }),
    );
    expect(await screen.findByText(/Partita IVA non valida/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Partita IVA/));
    await user.type(screen.getByLabelText(/Partita IVA/), "01234567897");
    await user.click(
      within(companyForm()).getByRole("button", {
        name: "Salva",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Puoi usare subito tutti i moduli/)).not.toBeInTheDocument(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("working offline", () => {
  it("creates a customer from the list and finds it again", async () => {
    const ws = await testWorkspace();
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await user.click(await screen.findByRole("link", { name: "Anagrafiche" }));
    await user.click(await screen.findByRole("button", { name: "Nuovo" }));
    await user.type(await screen.findByLabelText(/Ragione sociale \/ Nome/), "Acme Srl");
    await user.selectOptions(screen.getByLabelText("Tipo *"), "customer");
    await user.click(screen.getByRole("button", { name: "Crea" }));
    expect(await screen.findByRole("heading", { name: "Acme Srl" })).toBeInTheDocument();
    expect((await ws.list("party")).rows.map((r) => r["name"])).toEqual(["Acme Srl"]);

    await user.click(screen.getByRole("link", { name: /← Anagrafiche/ }));
    expect(await screen.findByRole("link", { name: "Acme Srl" })).toBeInTheDocument();
    // the audit trail records the creation
    expect(
      (await ws.db.query("SELECT 1 FROM audit_log WHERE entity = 'party' AND action = 'create'"))
        .length,
    ).toBe(1);
  });

  it("shows validation errors from the data layer next to the field", async () => {
    const ws = await testWorkspace();
    const user = userEvent.setup();
    window.location.hash = "#/e/party/new";
    render(<App preloaded={ws} />);
    await user.type(await screen.findByLabelText(/Ragione sociale \/ Nome/), "X");
    await user.type(screen.getByLabelText(/Email/), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Crea" }));
    expect(await screen.findByText("Indirizzo email non valido")).toBeInTheDocument();
    expect((await ws.list("party")).total).toBe(0);
  });

  it("writes, issues and gets paid an invoice", async () => {
    const ws = await testWorkspace();
    const customer = await ws.create("party", { name: "Cliente Spa", kind: "customer" });
    const user = userEvent.setup();
    window.location.hash = "#/d/invoice/new";
    render(<App preloaded={ws} />);

    await user.selectOptions(await screen.findByLabelText(/Anagrafica/), customer.id);
    await user.type(screen.getByLabelText("Descrizione riga 1"), "Consulenza");
    await user.type(screen.getByLabelText("Prezzo riga 1"), "1000,00");
    expect((await screen.findAllByText(/1220,00/)).length).toBeGreaterThan(0); // total with 22% VAT

    await user.click(screen.getByRole("button", { name: "Emetti" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    await user.click(within(dialog).getByRole("button", { name: "Emetti" }));

    await waitFor(async () =>
      expect((await ws.list("document", { filters: { status: "issued" } })).total).toBe(1),
    );
    const [invoice] = (await ws.list("document")).rows;
    expect(String(invoice?.["number"])).toMatch(/^FT \d{4}\/0001$/);
    expect(invoice?.["total"]).toBe(122000);

    expect(await screen.findByRole("heading", { name: /Incassi/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registra" }));
    await waitFor(async () => expect((await ws.list("payment")).total).toBe(1));
    expect((await ws.list("payment")).rows[0]?.["amount"]).toBe(122000);
  });
});

describe("optional server link", () => {
  it("rejects an insecure server address", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const ws = await testWorkspace();
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await openSettings(user, "Account e server");
    await user.type(
      await screen.findByLabelText("Indirizzo del server"),
      "http://erp.vyrncore.lan",
    );
    const card = within(
      screen.getByRole("heading", { name: /Server aziendale/ }).closest("section") as HTMLElement,
    );
    await user.click(card.getByRole("button", { name: "Salva" }));
    expect(card.getByRole("alert")).toHaveTextContent("È richiesto HTTPS");
    expect(localStorage.getItem("vyrion.serverUrl")).toBeNull();
  });

  it("connects after a valid address is saved and shows real component data", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(READY))));
    vi.stubGlobal("fetch", fetchSpy);
    const ws = await testWorkspace();
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await openSettings(user, "Account e server");
    await user.type(
      await screen.findByLabelText("Indirizzo del server"),
      "https://erp.vyrncore.lan/",
    );
    const card = within(
      screen.getByRole("heading", { name: /Server aziendale/ }).closest("section") as HTMLElement,
    );
    await user.click(card.getByRole("button", { name: "Salva" }));
    expect(localStorage.getItem("vyrion.serverUrl")).toBe("https://erp.vyrncore.lan");

    await user.click(card.getByRole("link", { name: "Stato del server" }));
    const main = within(screen.getByRole("main"));
    await waitFor(() => expect(main.getByText("Connesso")).toBeInTheDocument());
    expect(main.getByText("9.9.9")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://erp.vyrncore.lan/api/v1/health/ready",
      expect.anything(),
    );
  });

  it("switches and persists the theme", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const ws = await testWorkspace();
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await openSettings(user, "Impostazioni software");
    await user.click(await screen.findByRole("radio", { name: "Chiaro" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("vyrion.theme")).toBe("light");
  });
});
