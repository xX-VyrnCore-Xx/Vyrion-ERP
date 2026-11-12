import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NAV, isHere, itemIsHere, type Place } from "../../app/nav";
import { AccountMenu, initials } from "../AccountMenu";
import { Sidebar } from "../Sidebar";

const place = (path: string, query = ""): Place => ({ path, query: new URLSearchParams(query) });

function show(at: Place, onNavigate: (to: string) => void = () => undefined) {
  return render(
    <Sidebar
      place={at}
      onNavigate={onNavigate}
      connection="unconfigured"
      companyName={null}
      theme="dark"
      onThemeChange={() => undefined}
    />,
  );
}

beforeEach(() => window.localStorage.clear());

describe("menu model", () => {
  it("knows where the person is, with sub-menu entries and queries", () => {
    expect(isHere("e/party", place("e/party/123"))).toBe(true);
    expect(isHere("e/party", place("e/contact"))).toBe(false);
    expect(isHere("", place(""))).toBe(true);
    expect(isHere("", place("settings"))).toBe(false);
    // the invoices tab is the default of the documents page
    expect(isHere("documents?type=invoice", place("documents"), [], true)).toBe(true);
    expect(isHere("documents?type=quote", place("documents"), [], false)).toBe(false);
    expect(isHere("documents?type=quote", place("documents", "type=quote"))).toBe(true);
    const documents = NAV.flatMap((s) => s.items).find((i) => i.to === "documents");
    expect(documents && itemIsHere(documents, place("d/invoice/abc"))).toBe(true);
  });

  it("has no duplicate routes among the sub-menus", () => {
    for (const item of NAV.flatMap((s) => s.items)) {
      const targets = (item.children ?? []).map((c) => c.to);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

describe("Sidebar", () => {
  it("opens the sub-menu of the page the person is on and highlights the entry", () => {
    show(place("e/contact"));
    const sub = screen.getByRole("list", { name: "Sottomenu Anagrafiche" });
    expect(within(sub).getByRole("link", { name: "Contatti" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sub).getByRole("link", { name: "Clienti e fornitori" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens and closes a sub-menu by hand and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = show(place(""));
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Apri il sottomenu Pipeline" }));
    expect(screen.getByRole("list", { name: "Sottomenu Pipeline" })).toBeInTheDocument();
    unmount();
    show(place(""));
    expect(screen.getByRole("list", { name: "Sottomenu Pipeline" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Chiudi il sottomenu Pipeline" }));
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
  });

  it("goes to the item and opens its sub-menu when the label is clicked", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    show(place(""), go);
    await user.click(screen.getByRole("link", { name: "Pipeline" }));
    expect(go).toHaveBeenCalledWith("pipeline");
    expect(screen.getByRole("list", { name: "Sottomenu Pipeline" })).toBeInTheDocument();
  });

  it("folds a group but keeps the entry the person is on", async () => {
    const user = userEvent.setup();
    show(place("e/party"));
    expect(screen.getByRole("link", { name: "Pipeline" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "CRM" }));
    expect(screen.queryByRole("link", { name: "Pipeline" })).toBeNull();
    expect(screen.getByRole("link", { name: "Anagrafiche" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "CRM" }));
    expect(screen.getByRole("link", { name: "Pipeline" })).toBeInTheDocument();
  });

  it("no longer has a Settings entry: they are in the account menu", () => {
    show(place(""));
    expect(screen.queryByRole("link", { name: "Impostazioni" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Account e profilo/ })).toBeInTheDocument();
  });
});

describe("AccountMenu", () => {
  const menu = (go: (to: string) => void, change = vi.fn()) =>
    render(
      <AccountMenu
        connection="online"
        companyName="VyrnCore Srl"
        theme="dark"
        onThemeChange={change}
        onNavigate={go}
      />,
    );

  it("shows the profile with the connection and opens the settings sections", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    menu(go);
    const button = screen.getByRole("button", { name: "Account e profilo: VyrnCore Srl" });
    expect(within(button).getByText("Connesso")).toBeInTheDocument();
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: /Dati e backup/ }));
    expect(go).toHaveBeenCalledWith("settings/data");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes with Escape and changes the theme", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    menu(() => undefined, change);
    await user.click(screen.getByRole("button", { name: /^Account e profilo/ }));
    await user.click(screen.getByRole("button", { name: "Tema chiaro" }));
    expect(change).toHaveBeenCalledWith("light");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("builds initials from the company name", () => {
    expect(initials("VyrnCore Enterprises")).toBe("VE");
    expect(initials("Acme")).toBe("AC");
    expect(initials(null)).toBe("VE");
  });
});
