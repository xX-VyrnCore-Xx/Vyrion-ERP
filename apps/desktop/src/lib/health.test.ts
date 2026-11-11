import { describe, expect, it, vi } from "vitest";

import { fetchReadiness } from "./health";

const BASE = "https://erp.vyrncore.lan";

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("fetchReadiness", () => {
  it("maps a healthy answer to online", async () => {
    const spy = mockFetch(() =>
      json({
        status: "ok",
        version: "0.1.0",
        components: {
          database: { status: "ok", latency_ms: 1.5 },
          redis: { status: "ok", latency_ms: 0.4 },
        },
      }),
    );
    expect(await fetchReadiness(BASE)).toEqual({
      state: "online",
      version: "0.1.0",
      components: {
        database: { status: "ok", latencyMs: 1.5 },
        redis: { status: "ok", latencyMs: 0.4 },
      },
    });
    expect(spy.mock.calls[0]?.[0]).toBe(`${BASE}/api/v1/health/ready`);
  });

  it("maps a 503 with a valid body to degraded", async () => {
    mockFetch(() =>
      json(
        {
          status: "degraded",
          version: "0.1.0",
          components: { database: { status: "error", latency_ms: null } },
        },
        503,
      ),
    );
    expect(await fetchReadiness(BASE)).toEqual({
      state: "degraded",
      version: "0.1.0",
      components: { database: { status: "error", latencyMs: null } },
    });
  });

  it("treats network failures as offline", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchReadiness(BASE)).toEqual({ state: "offline" });
  });

  it("does not mistake a foreign host for the server", async () => {
    mockFetch(() => Promise.resolve(new Response("<html>Login</html>", { status: 200 })));
    expect(await fetchReadiness(BASE)).toEqual({ state: "offline" });
    mockFetch(() => json({ status: "ok" }));
    expect(await fetchReadiness(BASE)).toEqual({ state: "offline" });
    mockFetch(() => json({ error: "not found" }, 404));
    expect(await fetchReadiness(BASE)).toEqual({ state: "offline" });
  });

  it("times out when the server never answers", async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(await fetchReadiness(BASE, { timeoutMs: 20 })).toEqual({ state: "offline" });
  });
});
