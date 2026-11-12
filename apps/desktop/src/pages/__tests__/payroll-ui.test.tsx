import { render, screen, waitFor } from "@testing-library/react";
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

describe("Payroll page", () => {
  it("shows the month's hours, generates and registers a payslip", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    await ws.create("employee", {
      first_name: "Mario",
      last_name: "Rossi",
      hire_date: "2025-01-01",
      gross_monthly: 200000,
      contrib_employee_pct: 10,
      tax_pct: 20,
    });
    window.location.hash = "#/payroll";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect(await screen.findByText("Mario Rossi")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Buste paga" }));
    await user.click(await screen.findByRole("button", { name: /Genera le buste paga mancanti/ }));
    expect(await screen.findByText(/Create 1 buste paga in bozza/)).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Registra la busta paga di Mario Rossi" }),
    );
    expect(await screen.findByText(/registrata in prima nota/)).toBeInTheDocument();
    await waitFor(async () =>
      expect((await ws.list("payslip", {})).rows[0]).toMatchObject({ status: "registered" }),
    );
  });
});
