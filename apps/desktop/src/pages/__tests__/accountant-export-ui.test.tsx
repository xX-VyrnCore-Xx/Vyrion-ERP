import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { testWorkspace } from "../../test/workspace";

const saved: { name: string; size: number }[] = [];
vi.mock("../../ui/saveBytes", () => ({
  saveBytes: (name: string, bytes: Uint8Array) => {
    saved.push({ name, size: bytes.length });
    return Promise.resolve(true);
  },
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
  saved.length = 0;
});

describe("accountant export page", () => {
  it("lists the files of the year and saves the ZIP package", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    window.location.hash = "#/accountant-export";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    expect(await screen.findByText("prima-nota_2026.csv")).toBeInTheDocument();
    expect(screen.getByText("registro-vendite_2026.csv")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scarica il pacchetto (.zip)" }));
    expect(await screen.findByText(/commercialista_2026\.zip salvato/)).toBeInTheDocument();
    expect(saved[0]?.name).toBe("commercialista_2026.zip");
    expect(saved[0]?.size).toBeGreaterThan(500);
  });
});
