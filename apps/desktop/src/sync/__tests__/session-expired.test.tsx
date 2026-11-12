import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { setSetting } from "../../data/system";
import { testWorkspace } from "../../test/workspace";

// The access token is long expired, so the first call tries to renew it.
const session = {
  serverUrl: "https://erp.vyrncore.lan",
  email: "ada@example.com",
  accessToken: "vat_old",
  accessExpiresAt: "2020-01-01T00:00:00Z",
  refreshToken: "vrt_old",
  refreshExpiresAt: "2099-01-01T00:00:00Z",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  window.location.hash = "";
  localStorage.setItem("vyrion.serverUrl", session.serverUrl);
});
afterEach(() => vi.unstubAllGlobals());

describe("a session that can no longer be renewed", () => {
  it("asks to sign in again, keeps the changes, and sends them after the password", async () => {
    let signedIn = false;
    const calls: string[] = [];
    const pushed: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.endsWith("/health/ready"))
          return json({ status: "ok", version: "1", components: {} });
        if (url.endsWith("/auth/refresh"))
          return json({ error: { code: "invalid_token", message: "Token non valido" } }, 401);
        if (url.endsWith("/auth/login")) {
          signedIn = true;
          return json({
            status: "authenticated",
            tokens: {
              access_token: "vat_new",
              access_expires_at: "2099-01-01T00:00:00Z",
              refresh_token: "vrt_new",
              refresh_expires_at: "2099-01-01T00:00:00Z",
            },
            second_factor: null,
          });
        }
        if (!signedIn) return json({ error: { code: "invalid_token", message: "x" } }, 401);
        if (url.includes("/sync/push")) {
          const body = JSON.parse(String(init?.body)) as { operations: { op_id: string }[] };
          pushed.push(...body.operations);
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
          return json({ changes: [], cursor: 0, has_more: false, server_time: "x" });
        return json({}, 404);
      }),
    );
    const ws = await testWorkspace();
    await ws.setSyncEnabled(true);
    await ws.create("party", { name: "Creato prima della scadenza" });
    await setSetting(ws.db, "sync.session", session, ws.ctx.now());
    window.location.hash = "#/settings/account";
    const user = userEvent.setup();
    render(<App preloaded={ws} />);

    expect(await screen.findByText(/La sessione con il server è scaduta/)).toBeInTheDocument();
    expect((await screen.findAllByText("Accedi di nuovo al server")).length).toBeGreaterThan(0);
    expect(pushed).toHaveLength(0);
    // no endless retries while waiting for the password
    const refreshes = calls.filter((u) => u.endsWith("/auth/refresh")).length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls.filter((u) => u.endsWith("/auth/refresh")).length).toBe(refreshes);

    await user.type(screen.getByLabelText("Password"), "segreta");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.queryByText(/La sessione con il server è scaduta/)).not.toBeInTheDocument(),
    );
    expect((await screen.findAllByText("Sincronizzato")).length).toBeGreaterThan(0);
  });

  it("keeps trying, quietly, when the server is only restarting (503)", async () => {
    let up = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/health/ready"))
          return json({ status: "ok", version: "1", components: {} });
        if (!up) return json({ error: { message: "x" } }, 503, { "Retry-After": "1" });
        if (url.includes("/sync/pull"))
          return json({ changes: [], cursor: 0, has_more: false, server_time: "x" });
        return json({ results: [] });
      }),
    );
    const ws = await testWorkspace();
    await ws.setSyncEnabled(true);
    await setSetting(
      ws.db,
      "sync.session",
      { ...session, accessExpiresAt: "2099-01-01T00:00:00Z" },
      ws.ctx.now(),
    );
    window.location.hash = "#/settings/account";
    render(<App preloaded={ws} />);
    // a 503 is shown as "offline, retrying", never as a failure of the account
    expect(await screen.findByText(/Server non raggiungibile: i dati restano/)).toBeInTheDocument();
    expect(screen.queryByText(/La sessione con il server è scaduta/)).not.toBeInTheDocument();
    up = true;
    await waitFor(
      () => expect(screen.queryByText(/Server non raggiungibile: i dati restano/)).toBeNull(),
      { timeout: 4000 },
    );
  });
});
