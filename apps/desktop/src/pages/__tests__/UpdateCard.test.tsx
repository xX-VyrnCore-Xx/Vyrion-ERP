import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatesProvider } from "../../app/updates";
import { UpdateBanner } from "../../ui/UpdateBanner";

const calls: string[] = [];
let found: { version: string; notes: string | null; date: string | null } | null = null;
let fail: string | null = null;

vi.mock("../../lib/native", async (original) => {
  const real = await original<typeof import("../../lib/native")>();
  return {
    ...real,
    inDesktop: () => true,
    native: { ...real.native, appInfo: async () => ({ version: "1.2.3" }) },
  };
});
vi.mock("../../lib/updates", () => ({
  updates: {
    available: () => true,
    check: async () => {
      calls.push("check");
      if (fail) throw new Error(fail);
      return found;
    },
    install: async (onProgress: (p: { downloaded: number; total: number | null }) => void) => {
      calls.push("install");
      onProgress({ downloaded: 50, total: 100 });
    },
    restart: async () => void calls.push("restart"),
  },
}));

import { UpdateCard } from "../UpdateCard";

beforeEach(() => {
  calls.length = 0;
  found = null;
  fail = null;
  window.localStorage.clear();
});

function show() {
  render(
    <UpdatesProvider>
      <UpdateBanner />
      <UpdateCard />
    </UpdatesProvider>,
  );
}

describe("updates", () => {
  it("shows the installed version and says when it is the latest", async () => {
    const user = userEvent.setup();
    show();
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Controlla aggiornamenti" }));
    expect(await screen.findByText("Hai già l'ultima versione.")).toBeInTheDocument();
  });

  it("offers a newer version, installs it and then asks to restart", async () => {
    found = { version: "9.9.9", notes: "Novità", date: null };
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Controlla aggiornamenti" }));
    expect(await screen.findByText(/Vyrion ERP 9\.9\.9/)).toBeInTheDocument();
    expect(screen.getByText("Novità")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aggiorna ora" }));
    expect(await screen.findByText("Versione 9.9.9 installata.")).toBeInTheDocument();
    expect(calls).toEqual(["check", "install"]);

    const restartButtons = screen.getAllByRole("button", { name: "Riavvia ora" });
    await user.click(restartButtons[0] as HTMLElement);
    expect(calls).toContain("restart");
  });

  it("reports a failed manual check", async () => {
    fail = "rete assente";
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Controlla aggiornamenti" }));
    expect(
      await screen.findByText(/Impossibile controllare gli aggiornamenti: rete assente/),
    ).toBeInTheDocument();
  });

  it("remembers that the automatic check was switched off", async () => {
    const user = userEvent.setup();
    show();
    const box = await screen.findByRole("checkbox");
    expect(box).toBeChecked();
    await user.click(box);
    await waitFor(() => expect(window.localStorage.getItem("vyrion.autoUpdate")).toBe("off"));
  });
});
