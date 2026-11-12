import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { testWorkspace } from "../../test/workspace";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  window.location.hash = "#/settings/account";
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("trying the connection to the server", () => {
  it("says the server answers, with its version and components", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          status: "ok",
          version: "0.9.1",
          components: {
            database: { status: "ok", latency_ms: 3 },
            redis: { status: "ok", latency_ms: 1 },
          },
        }),
      ),
    );
    const user = userEvent.setup();
    render(<App preloaded={await testWorkspace()} />);
    await user.type(
      await screen.findByLabelText("Indirizzo del server"),
      "https://erp.vyrncore.lan",
    );
    await user.click(screen.getByRole("button", { name: "Prova il collegamento" }));
    expect(await screen.findByText("Server raggiungibile.")).toBeInTheDocument();
    expect(screen.getByText(/Versione 0\.9\.1 · database: ok · redis: ok/)).toBeInTheDocument();
  });

  it("explains what to check when the server does not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("down"))),
    );
    const user = userEvent.setup();
    render(<App preloaded={await testWorkspace()} />);
    await user.type(
      await screen.findByLabelText("Indirizzo del server"),
      "https://erp.vyrncore.lan",
    );
    await user.click(screen.getByRole("button", { name: "Prova il collegamento" }));
    expect(await screen.findByText("Il server non risponde.")).toBeInTheDocument();
    expect(screen.getByText(/la VPN sia attiva/)).toBeInTheDocument();
  });

  it("does not try an address that is not valid", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<App preloaded={await testWorkspace()} />);
    await user.type(
      await screen.findByLabelText("Indirizzo del server"),
      "http://erp.vyrncore.lan",
    );
    await user.click(screen.getByRole("button", { name: "Prova il collegamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("È richiesto HTTPS");
    expect(
      fetchSpy.mock.calls.filter(([u]) => String(u).includes("erp.vyrncore.lan")),
    ).toHaveLength(0);
  });
});
