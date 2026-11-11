import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppContext } from "../../app/context";
import { testWorkspace } from "../../test/workspace";

const calls: [string, unknown][] = [];
let supported = true;

vi.mock("../../lib/native", async (original) => {
  const real = await original<typeof import("../../lib/native")>();
  return {
    ...real,
    inDesktop: () => true,
    shell: {
      prefs: async () => ({ tray_supported: supported, close_to_tray: true }),
      setCloseToTray: async (enabled: boolean) => void calls.push(["close", enabled]),
      quit: async () => void calls.push(["quit", null]),
    },
  };
});

import { ShellCard } from "../ShellCard";

beforeEach(() => {
  calls.length = 0;
  supported = true;
});

async function show() {
  const ws = await testWorkspace();
  render(
    <AppContext.Provider value={{ ws, volatile: false }}>
      <ShellCard />
    </AppContext.Provider>,
  );
}

describe("ShellCard", () => {
  it("lets the person choose between hiding in the tray and quitting on close", async () => {
    await show();
    const box = await screen.findByRole("checkbox", {
      name: /lascia Vyrion ERP attivo nella barra/,
    });
    expect(box).toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(calls).toContainEqual(["close", false]));
    expect(box).not.toBeChecked();
  });

  it("can end the application for good", async () => {
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Esci da Vyrion ERP" }));
    expect(calls).toContainEqual(["quit", null]);
  });

  it("hides the tray choice where there is no tray but still offers quit", async () => {
    supported = false;
    await show();
    expect(await screen.findByRole("button", { name: "Esci da Vyrion ERP" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
