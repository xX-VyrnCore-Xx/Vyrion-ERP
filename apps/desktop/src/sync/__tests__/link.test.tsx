import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { testWorkspace } from "../../test/workspace";

beforeEach(() => {
  window.location.hash = "";
});

const tokens = {
  token_type: "Bearer",
  session_id: "s",
  access_token: "vat_a",
  access_expires_at: "2099-01-01T00:00:00Z",
  refresh_token: "vrt_a",
  refresh_expires_at: "2099-01-01T00:00:00Z",
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe("linking to the server later", () => {
  it("signs in, sends the existing data once and shows the link", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/health/ready"))
          return json({ status: "ok", version: "1", components: {} });
        if (url.endsWith("/auth/login"))
          return json({ status: "authenticated", tokens, second_factor: null });
        if (url.includes("/sync/push")) {
          const body = JSON.parse(String(init?.body)) as {
            operations: { op_id: string; entity_id: string }[];
          };
          sent.push(...body.operations);
          return json({
            results: body.operations.map((o) => ({
              op_id: o.op_id,
              status: "applied",
              version: 1,
              reason: null,
              conflicting_fields: [],
              server: null,
            })),
          });
        }
        if (url.includes("/sync/pull"))
          return json({
            changes: [],
            cursor: 0,
            has_more: false,
            server_time: "2026-01-01T00:00:00Z",
          });
        return json({}, 404);
      }),
    );
    const ws = await testWorkspace();
    await ws.create("party", { name: "Cliente prima del collegamento" });
    localStorage.setItem("vyrion.serverUrl", "https://erp.vyrncore.lan");

    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await user.click(await screen.findByRole("button", { name: /^Account e profilo/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Account e server/ }));
    const card = within(
      (await screen.findByRole("heading", { name: "Sincronizzazione" })).closest(
        "section",
      ) as HTMLElement,
    );
    await user.type(card.getByLabelText("Email"), "ada@example.com");
    await user.type(card.getByLabelText("Password"), "correct horse battery staple");
    await user.click(card.getByRole("button", { name: "Collega" }));

    expect(await card.findByText("Collegato come")).toBeInTheDocument();
    expect(card.getByText("ada@example.com")).toBeInTheDocument();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    // the record entered before the link reached the server, and nothing is left waiting
    await waitFor(async () =>
      expect(await ws.db.query("SELECT 1 FROM sync_outbox WHERE status = 'pending'")).toHaveLength(
        0,
      ),
    );
    expect(
      (
        await ws.db.query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity = 'party'",
        )
      )[0]?.n,
    ).toBe(1);
    // the token is kept inside the encrypted database, not in the browser storage
    expect(localStorage.getItem("vyrion.syncSession")).toBeNull();
    expect((await ws.db.query("SELECT 1 FROM settings WHERE key = 'sync.session'")).length).toBe(1);
  });

  it("shows a wrong password as an error and stays unlinked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.endsWith("/auth/login")
          ? json({ error: { code: "unauthenticated", message: "Credenziali non valide" } }, 401)
          : json({ status: "ok", version: "1", components: {} }),
      ),
    );
    const ws = await testWorkspace();
    localStorage.setItem("vyrion.serverUrl", "https://erp.vyrncore.lan");
    const user = userEvent.setup();
    render(<App preloaded={ws} />);
    await user.click(await screen.findByRole("button", { name: /^Account e profilo/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Account e server/ }));
    const card = within(
      (await screen.findByRole("heading", { name: "Sincronizzazione" })).closest(
        "section",
      ) as HTMLElement,
    );
    await user.type(card.getByLabelText("Email"), "ada@example.com");
    await user.type(card.getByLabelText("Password"), "wrong");
    await user.click(card.getByRole("button", { name: "Collega" }));
    expect(await card.findByText("Credenziali non valide")).toBeInTheDocument();
    expect(await ws.db.query("SELECT 1 FROM sync_outbox")).toHaveLength(0);
  });
});
