const STORAGE_KEY = "vyrion.serverUrl";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type ServerUrlError = "urlEmpty" | "urlInvalid" | "urlInsecure" | "urlCredentials";
export type ServerUrlResult = { ok: true; url: string } | { ok: false; error: ServerUrlError };

/**
 * Validates and normalises the backend base URL.
 * HTTPS is mandatory; plain HTTP is accepted only for loopback (local development).
 */
export function parseServerUrl(input: string): ServerUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "urlEmpty" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "urlInvalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "urlInvalid" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, error: "urlCredentials" };
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    return { ok: false, error: "urlInsecure" };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${path}` };
}

export function loadServerUrl(): string | null {
  const candidates = [readStorage(), import.meta.env.VITE_DEFAULT_SERVER_URL];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const result = parseServerUrl(candidate);
    if (result.ok) return result.url;
  }
  return null;
}

export function saveServerUrl(url: string | null): void {
  try {
    if (url === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // Storage unavailable: the value still applies for the current session.
  }
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
