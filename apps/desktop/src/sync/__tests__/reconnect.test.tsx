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
    window.location.hash = "#/settings/account";
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
