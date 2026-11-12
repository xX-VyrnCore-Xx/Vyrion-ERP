import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

const clock = () => new Date("2026-06-15T10:00:00Z");

describe("calendar exchange", () => {
  it("imports an .ics file and reports what it did", async () => {
    const ws = await testWorkspace("ordinario", clock);
    window.location.hash = "#/calendar";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:x-1@example.org",
      "DTSTART:20260616T090000Z",
      "SUMMARY:Riunione esterna",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    await user.upload(
      await screen.findByLabelText("Calendario .ics"),
      new File([ics], "cal.ics", { type: "text/calendar" }),
    );
    expect(await screen.findByText(/Calendario importato: 1 nuovi/)).toBeInTheDocument();
    expect((await ws.list("appointment", {})).rows[0]?.["title"]).toBe("Riunione esterna");
  });
});

describe("billing hours page", () => {
  it("creates a draft invoice for a customer's unbilled hours", async () => {
    const ws = await testWorkspace("ordinario", clock);
    const customer = await ws.create("party", {
      name: "Verdi Spa",
      kind: "customer",
      hourly_rate: 5000,
    });
    const ticket = await ws.create("ticket", {
      party_id: customer.id,
      subject: "Server",
      status: "open",
    });
    await ws.create("ticket_intervention", {
      ticket_id: ticket.id,
      performed_on: "2026-06-10",
      minutes: 120,
    });
    window.location.hash = "#/billing-hours";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect(await screen.findByLabelText("Tariffa oraria per Verdi Spa")).toHaveValue("50.00");
    await user.click(screen.getByRole("button", { name: "Crea bozza di fattura" }));
    await waitFor(async () => {
      const docs = (await ws.list("document", { limit: 5 })).rows;
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ type: "invoice", status: "draft", net_total: 10000 });
    });
    expect((await ws.list("ticket_intervention", {})).rows[0]?.["document_id"]).toBeTruthy();
  });
});
