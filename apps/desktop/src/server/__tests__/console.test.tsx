import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { setSetting } from "../../data/system";
import { testWorkspace } from "../../test/workspace";

const session = {
  serverUrl: "https://erp.vyrncore.lan",
  email: "ada@example.com",
  accessToken: "vat_a",
  accessExpiresAt: "2099-01-01T00:00:00Z",
  refreshToken: "vrt_a",
  refreshExpiresAt: "2099-01-01T00:00:00Z",
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  window.location.hash = "";
  localStorage.setItem("vyrion.serverUrl", session.serverUrl);
});
afterEach(() => vi.unstubAllGlobals());

describe("server console", () => {
  it("asks to sign in before showing administration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ status: "ok", version: "1", components: {} })),
    );
    window.location.hash = "#/server/utenti";
    render(<App preloaded={await testWorkspace()} />);
    expect(await screen.findByRole("heading", { name: "Console del server" })).toBeInTheDocument();
    expect(await screen.findByText(/accedi con un account aziendale/i)).toBeInTheDocument();
  });

  it("lists the server's users once signed in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/health/ready"))
          return json({ status: "ok", version: "1", components: {} });
        if (url.includes("/sync/pull"))
          return json({ changes: [], cursor: 0, has_more: false, server_time: "x" });
        if (url.includes("/sync/push")) return json({ results: [] });
        if (url.includes("/users"))
          return json({
            items: [
              {
                id: "u1",
                version: 1,
                email: "bea@example.com",
                full_name: "Bea Rossi",
                is_active: true,
                has_password: true,
                totp_enabled: false,
                locked_until: null,
                last_login_at: null,
                roles: [{ id: "r", key: "admin", name: "Amministratore", is_system: true }],
                direct_permissions: [],
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
            next_cursor: null,
          });
        if (url.endsWith("/roles")) return json([]);
        return json({}, 404);
      }),
    );
    const ws = await testWorkspace();
    await setSetting(ws.db, "sync.session", session, ws.ctx.now());
    window.location.hash = "#/server/utenti";
    render(<App preloaded={ws} />);
    expect(await screen.findByText("Bea Rossi")).toBeInTheDocument();
    expect(screen.getByText("Amministratore")).toBeInTheDocument();
  });
});

describe("backups pane", () => {
  it("shows the real outcome of the backup service, including a failure", async () => {
    const run = (kind: string, ok: boolean, error: string | null) => ({
      kind,
      ok,
      file: "daily/vyrion-1.dump.age",
      size_bytes: 2048,
      sha256: "a".repeat(64),
      started_at: "2026-11-12T02:30:00Z",
      finished_at: "2026-11-12T02:31:00Z",
      error,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/health/ready"))
          return json({ status: "ok", version: "1", components: {} });
        if (url.includes("/sync/pull"))
          return json({ changes: [], cursor: 0, has_more: false, server_time: "x" });
        if (url.includes("/sync/push")) return json({ results: [] });
        if (url.endsWith("/backups"))
          return json({
            configured: true,
            last_backup: run("backup", false, "disco pieno"),
            last_verify: run("verify", true, null),
            last_restore_test: null,
            stale: true,
            stale_after_hours: 36,
            runs: [run("backup", false, "disco pieno")],
            files: [
              {
                name: "vyrion-1.dump.age",
                tier: "daily",
                size_bytes: 2048,
                modified_at: "2026-11-12T02:31:00Z",
              },
            ],
          });
        return json({}, 404);
      }),
    );
    const ws = await testWorkspace();
    await setSetting(ws.db, "sync.session", session, ws.ctx.now());
    window.location.hash = "#/server/backup";
    render(<App preloaded={ws} />);
    expect(
      await screen.findByText(/Nessun backup riuscito nelle ultime 36 ore/),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("disco pieno")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mai eseguita/)).toBeInTheDocument();
    expect(screen.getByText("vyrion-1.dump.age")).toBeInTheDocument();
  });
});

describe("coming back online", () => {
  it("retries at once when the network returns and sends what waited", async () => {
    let online = false;
    const pushed: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/health/ready"))
          return online
            ? json({ status: "ok", version: "1", components: {} })
            : Promise.reject(new TypeError("down"));
        if (!online) return Promise.reject(new TypeError("down"));
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
    await ws.create("party", { name: "Creato offline" });
    await setSetting(ws.db, "sync.session", session, ws.ctx.now());
    window.location.hash = "#/server/stato";
    render(<App preloaded={ws} />);
    expect(await screen.findByText(/Server non raggiungibile: i dati restano/)).toBeInTheDocument();
    expect(pushed).toHaveLength(0);

    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(
        screen.queryByText(/Server non raggiungibile: i dati restano/),
      ).not.toBeInTheDocument(),
    );
  });
});
