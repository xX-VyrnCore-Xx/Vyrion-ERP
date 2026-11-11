import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

const READY = {
  status: "ok",
  version: "9.9.9",
  components: {
    database: { status: "ok", latency_ms: 2 },
    redis: { status: "ok", latency_ms: 1 },
  },
};

describe("App", () => {
  it("starts unconfigured and makes no network request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<App />);
    expect(screen.getAllByText("Server non configurato").length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an insecure server address", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.type(screen.getByLabelText("Indirizzo del server"), "http://erp.vyrncore.lan");
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(screen.getByRole("alert")).toHaveTextContent("È richiesto HTTPS");
    expect(localStorage.getItem("vyrion.serverUrl")).toBeNull();
  });

  it("connects after a valid address is saved and shows real component data", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(READY))));
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.type(screen.getByLabelText("Indirizzo del server"), "https://erp.vyrncore.lan/");
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(localStorage.getItem("vyrion.serverUrl")).toBe("https://erp.vyrncore.lan");

    await user.click(screen.getByRole("button", { name: "Stato del sistema" }));
    const main = within(screen.getByRole("main"));
    await waitFor(() => expect(main.getByText("Connesso")).toBeInTheDocument());
    expect(main.getByText("9.9.9")).toBeInTheDocument();
    expect(main.getByText("Database PostgreSQL")).toBeInTheDocument();
    expect(main.getAllByText("Operativo")).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://erp.vyrncore.lan/api/v1/health/ready",
      expect.anything(),
    );
  });

  it("shows the offline state when the server is unreachable", async () => {
    localStorage.setItem("vyrion.serverUrl", "https://erp.vyrncore.lan");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    render(<App />);
    const main = within(screen.getByRole("main"));
    await waitFor(() => expect(main.getByText("Non raggiungibile")).toBeInTheDocument());
    expect(main.getByRole("alert")).toHaveTextContent("VPN WireGuard");
  });

  it("switches and persists the theme", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.click(screen.getByRole("radio", { name: "Chiaro" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("vyrion.theme")).toBe("light");
  });
});
