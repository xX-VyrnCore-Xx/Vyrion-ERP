import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "../AccountMenu";

const props = {
  connection: "unconfigured" as const,
  companyName: "Rossi Srl",
  theme: "dark" as const,
  onThemeChange: vi.fn(),
};

describe("AccountMenu", () => {
  it("opens, offers the server link when not connected, and navigates", () => {
    const onNavigate = vi.fn();
    render(<AccountMenu {...props} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Account e profilo/ }));
    expect(screen.getByText("Solo su questo computer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collega al server" }));
    expect(onNavigate).toHaveBeenCalledWith("settings/account");
  });

  it("closes with Escape", () => {
    render(<AccountMenu {...props} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Account e profilo/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
