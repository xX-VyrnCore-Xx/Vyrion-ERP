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
  it("keeps the CRM, ERP and IT groups always open", () => {
    show(place(""));
    for (const name of ["CRM", "ERP", "IT"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Anagrafiche" })).toBeInTheDocument();
  });

  it("keeps every item at one row: the sections are not unfolded in the sidebar", () => {
    show(place("e/contact"));
    expect(screen.queryByRole("list", { name: "Sottomenu Anagrafiche" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Contatti" })).toBeNull();
    // the item of the page the person is on is the highlighted one
    expect(screen.getByRole("link", { name: "Anagrafiche" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the sections beside the sidebar, with the current one highlighted", async () => {
    const user = userEvent.setup();
    show(place("e/contact"));
    await user.click(screen.getByRole("button", { name: "Mostra le sezioni di Anagrafiche" }));
    const sub = screen.getByRole("list", { name: "Sottomenu Anagrafiche" });
    expect(within(sub).getByRole("link", { name: "Contatti" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sub).getByRole("link", { name: "Clienti e fornitori" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens with the pointer, closes with Escape or with the button, and goes to a section", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    show(place(""), go);
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
    await user.hover(screen.getByRole("link", { name: "Pipeline" }));
    const sub = await screen.findByRole("list", { name: "Sottomenu Pipeline" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mostra le sezioni di Pipeline" }));
    await user.click(screen.getByRole("button", { name: "Mostra le sezioni di Pipeline" }));
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mostra le sezioni di Pipeline" }));
    const first = within(screen.getByRole("list", { name: "Sottomenu Pipeline" })).getAllByRole(
      "link",
    )[0];
    expect(sub).toBeDefined();
    if (first) await user.click(first);
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
  });

  it("goes to the item when the label is clicked, without opening anything", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    show(place(""), go);
    await user.click(screen.getByRole("link", { name: "Pipeline" }));
    expect(go).toHaveBeenCalledWith("pipeline");
    expect(screen.queryByRole("list", { name: "Sottomenu Pipeline" })).toBeNull();
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

describe("Sidebar folded to icons", () => {
  it("folds with the button, keeps every page reachable by its name, and remembers it", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    const { unmount } = show(place(""), go);
    await user.click(screen.getByRole("button", { name: "Riduci la barra laterale" }));
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    // no visible text, but the links keep their accessible name and a tooltip
    // an item without sections gets a tooltip; one with sections shows them on hover instead
    expect(screen.getByRole("link", { name: "Comunicazioni" })).toHaveAttribute(
      "title",
      "Comunicazioni",
    );
    const link = screen.getByRole("link", { name: "Documenti" });
    await user.click(link);
    expect(go).toHaveBeenCalledWith("documents");
    // the groups stay (as separators) and no sub-menu is offered while folded
    expect(screen.queryByRole("heading", { name: "CRM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sezioni di/i })).not.toBeInTheDocument();
    unmount();
    // remembered on the next start
    show(place(""));
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Espandi la barra laterale" }));
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
  });

  it("toggles with Ctrl+B", async () => {
    const user = userEvent.setup();
    show(place(""));
    await user.keyboard("{Control>}b{/Control}");
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    await user.keyboard("{Control>}b{/Control}");
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false");
  });
});

describe("Sidebar sections when folded", () => {
  it("still lists the sections of an icon when the pointer is on it", async () => {
    const user = userEvent.setup();
    show(place(""));
    await user.click(screen.getByRole("button", { name: "Riduci la barra laterale" }));
    await user.hover(screen.getByRole("link", { name: "Documenti" }));
    const sub = await screen.findByRole("list", { name: "Sottomenu Documenti" });
    expect(within(sub).getByRole("link", { name: "Fatture" })).toBeInTheDocument();
  });
});
