import { describe, expect, it } from "vitest";

import { relativeTime, summarizeSync } from "../../app/syncStatus";
import { isTransient, login, needsSignIn, parseRetryAfter, ServerError } from "../api";

const reply = (body: string, status: number, headers: Record<string, string> = {}) =>
  (() => Promise.resolve(new Response(body, { status, headers }))) as unknown as typeof fetch;

describe("errors that mean «try again in a moment»", () => {
  it("treats a busy or restarting server as transient, with the pause it asked for", async () => {
    // a proxy answers 503 with an HTML page
    const busy = login(
      "https://erp",
      "a@b.it",
      "x",
      reply("<html>Service Unavailable</html>", 503, { "Retry-After": "7" }),
    );
    await expect(busy).rejects.toMatchObject({ status: 503, retryAfter: 7 });
    await expect(busy).rejects.toThrow(/riavviando o è sovraccarico/);
    const limited = login(
      "https://erp",
      "a@b.it",
      "x",
      reply(JSON.stringify({ error: { code: "rate_limited", message: "x" } }), 429),
    );
    await expect(limited).rejects.toThrow(/troppe richieste/);
    for (const status of [429, 502, 503, 504])
      expect(isTransient(new ServerError("x", status, "e"))).toBe(true);
    expect(isTransient(new ServerError("x", 0, "network"))).toBe(true);
    expect(isTransient(new ServerError("x", 0, "timeout"))).toBe(true);
  });

  it("does not retry a refusal, and tells a lapsed session apart", () => {
    expect(isTransient(new ServerError("no", 403, "forbidden"))).toBe(false);
    expect(isTransient(new ServerError("no", 422, "invalid"))).toBe(false);
    expect(isTransient(new Error("boom"))).toBe(false);
    expect(needsSignIn(new ServerError("x", 401, "invalid_token"))).toBe(true);
    expect(needsSignIn(new ServerError("x", 401, "session_expired"))).toBe(true);
    expect(needsSignIn(new ServerError("x", 403, "forbidden"))).toBe(false);
  });

  it("reads Retry-After in seconds and caps it", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("9999")).toBe(300);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("explains a server that cannot be reached", async () => {
    const down = (() => Promise.reject(new TypeError("down"))) as unknown as typeof fetch;
    await expect(login("https://erp", "a@b.it", "x", down)).rejects.toThrow(
      /indirizzo, la rete o la VPN/,
    );
  });
});

const base = {
  connected: true,
  syncing: false,
  reachable: true as boolean | null,
  retryIn: null,
  pending: 0,
  conflicts: [],
  needsLogin: false,
  error: null,
};

describe("the one-line summary of the link", () => {
  it("says nothing when not linked", () => {
    expect(summarizeSync({ ...base, connected: false })).toBeNull();
  });

  it("orders what matters: sign in, conflicts, syncing, offline, error, waiting, fine", () => {
    expect(summarizeSync({ ...base, needsLogin: true, pending: 3 })).toEqual({
      label: "Accedi di nuovo al server",
      tone: "danger",
    });
    const conflict = { id: 1 } as never;
    expect(summarizeSync({ ...base, conflicts: [conflict, conflict] })?.label).toBe(
      "2 conflitti da risolvere",
    );
    expect(summarizeSync({ ...base, syncing: true })?.tone).toBe("info");
    expect(summarizeSync({ ...base, reachable: false, pending: 4 })).toEqual({
      label: "Offline: 4 modifiche in attesa",
      tone: "warning",
    });
    expect(summarizeSync({ ...base, error: "boom" })?.tone).toBe("danger");
    expect(summarizeSync({ ...base, pending: 1 })?.label).toBe("1 modifica in attesa");
    expect(summarizeSync(base)).toEqual({ label: "Sincronizzato", tone: "ok" });
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  it("speaks in minutes, hours and days", () => {
    expect(relativeTime(null, now)).toBe("mai");
    expect(relativeTime("2026-06-15T11:59:40Z", now)).toBe("adesso");
    expect(relativeTime("2026-06-15T11:57:00Z", now)).toBe("3 minuti fa");
    expect(relativeTime("2026-06-15T11:00:00Z", now)).toBe("1 ora fa");
    expect(relativeTime("2026-06-15T07:00:00Z", now)).toBe("5 ore fa");
    expect(relativeTime("2026-06-14T10:00:00Z", now)).toBe("ieri");
    expect(relativeTime("2026-06-10T12:00:00Z", now)).toBe("5 giorni fa");
  });
});
