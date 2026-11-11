import { describe, expect, it } from "vitest";

import { loadServerUrl, parseServerUrl, saveServerUrl } from "./serverUrl";

describe("parseServerUrl", () => {
  it("accepts HTTPS and strips trailing slashes", () => {
    expect(parseServerUrl("  https://erp.vyrncore.lan/  ")).toEqual({
      ok: true,
      url: "https://erp.vyrncore.lan",
    });
    expect(parseServerUrl("https://10.8.0.1:8443/erp/")).toEqual({
      ok: true,
      url: "https://10.8.0.1:8443/erp",
    });
  });

  it("allows plain HTTP only on loopback", () => {
    expect(parseServerUrl("http://localhost:8000")).toEqual({
      ok: true,
      url: "http://localhost:8000",
    });
    expect(parseServerUrl("http://127.0.0.1:8000").ok).toBe(true);
    expect(parseServerUrl("http://erp.vyrncore.lan")).toEqual({ ok: false, error: "urlInsecure" });
    expect(parseServerUrl("http://localhost.evil.example")).toEqual({
      ok: false,
      error: "urlInsecure",
    });
  });

  it("rejects empty, malformed and non-HTTP input", () => {
    expect(parseServerUrl("   ")).toEqual({ ok: false, error: "urlEmpty" });
    expect(parseServerUrl("erp.vyrncore.lan")).toEqual({ ok: false, error: "urlInvalid" });
    expect(parseServerUrl("javascript:alert(1)")).toEqual({ ok: false, error: "urlInvalid" });
    expect(parseServerUrl("file:///etc/passwd")).toEqual({ ok: false, error: "urlInvalid" });
  });

  it("rejects embedded credentials", () => {
    expect(parseServerUrl("https://user:pass@erp.vyrncore.lan")).toEqual({
      ok: false,
      error: "urlCredentials",
    });
  });
});

describe("server URL persistence", () => {
  it("round-trips through storage", () => {
    expect(loadServerUrl()).toBeNull();
    saveServerUrl("https://erp.vyrncore.lan");
    expect(loadServerUrl()).toBe("https://erp.vyrncore.lan");
    saveServerUrl(null);
    expect(loadServerUrl()).toBeNull();
  });

  it("ignores a tampered stored value", () => {
    localStorage.setItem("vyrion.serverUrl", "http://attacker.example");
    expect(loadServerUrl()).toBeNull();
  });
});
