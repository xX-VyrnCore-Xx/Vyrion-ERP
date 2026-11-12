import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { saveDocument } from "../../modules/operations";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

describe("document PDF download", () => {
  it("saves a PDF of the open document", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    const customer = await ws.create("party", { name: "Cliente Spa", kind: "customer" });
    const quote = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "quote", date: "2026-04-01", party_id: customer.id },
        lines: [{ description: "Servizio", quantity: 2, unit_price: 5000, vat_rate: 22 }],
      }),
    );

    const saved: { blob: Blob; name: string }[] = [];
    URL.createObjectURL = (blob: Blob) => {
      saved.push({ blob, name: "" });
      return "blob:test";
    };
    URL.revokeObjectURL = () => undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      const last = saved[saved.length - 1];
      if (last) last.name = this.download;
    });

    window.location.hash = `#/d/quote/${quote.id}`;
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await user.click(await screen.findByRole("button", { name: "Scarica PDF" }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.name).toMatch(/^Preventivo-.*\.pdf$/);
    expect(saved[0]?.blob.type).toBe("application/pdf");
    expect(await saved[0]?.blob.text()).toMatch(/^%PDF-1\.4/);
    click.mockRestore();
  });
});
