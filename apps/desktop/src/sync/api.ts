/** HTTP client for the company server (login, token refresh, sync push/pull). */

export interface SyncSession {
  serverUrl: string;
  email: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

export interface WireOperation {
  op_id: string;
  entity: string;
  entity_id: string;
  kind: "create" | "update" | "delete";
  base_version: number;
  version?: number;
  payload: Record<string, unknown>;
}

export interface WireServerRecord {
  entity: string;
  entity_id: string;
  version: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

export interface WireResult {
  op_id: string;
  status: "applied" | "merged" | "duplicate" | "conflict" | "rejected";
  version: number | null;
  reason: string | null;
  conflicting_fields: string[];
  server: WireServerRecord | null;
}

export interface WireChange {
  seq: number;
  entity: string;
  entity_id: string;
  version: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

export interface WirePage {
  changes: WireChange[];
  cursor: number;
  has_more: boolean;
}

/** What the engine needs from a server; tests provide their own. */
export interface Transport {
  push(operations: WireOperation[]): Promise<WireResult[]>;
  pull(after: number, limit: number): Promise<WirePage>;
}

const TIMEOUT_MS = 30_000;

async function call<T>(
  url: string,
  init: { method: string; body?: unknown; token?: string },
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ServerError("Risposta del server non valida", response.status, "bad_response");
    }
    if (!response.ok) {
      const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ServerError(
        error?.message ?? `Errore del server (${response.status})`,
        response.status,
        error?.code ?? "error",
      );
    }
    return json as T;
  } catch (error) {
    if (error instanceof ServerError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ServerError("Il server non risponde", 0, "timeout");
    }
    throw new ServerError("Server non raggiungibile", 0, "network");
  } finally {
    clearTimeout(timer);
  }
}

interface WireTokens {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
}

const toSession = (serverUrl: string, email: string, tokens: WireTokens): SyncSession => ({
  serverUrl,
  email,
  accessToken: tokens.access_token,
  accessExpiresAt: tokens.access_expires_at,
  refreshToken: tokens.refresh_token,
  refreshExpiresAt: tokens.refresh_expires_at,
});

export type LoginOutcome =
  | { status: "authenticated"; session: SyncSession }
  | { status: "second_factor"; challenge: string };

export async function login(
  serverUrl: string,
  email: string,
  password: string,
  fetcher?: typeof fetch,
): Promise<LoginOutcome> {
  const result = await call<{
    status: string;
    tokens: WireTokens | null;
    second_factor: { challenge_token: string } | null;
  }>(`${serverUrl}/api/v1/auth/login`, { method: "POST", body: { email, password } }, fetcher);
  if (result.status === "authenticated" && result.tokens) {
    return { status: "authenticated", session: toSession(serverUrl, email, result.tokens) };
  }
  if (result.second_factor)
    return { status: "second_factor", challenge: result.second_factor.challenge_token };
  throw new ServerError("Risposta del server non valida", 0, "bad_response");
}

export async function secondFactor(
  serverUrl: string,
  email: string,
  challenge: string,
  code: string,
  fetcher?: typeof fetch,
): Promise<SyncSession> {
  const result = await call<{ tokens: WireTokens | null }>(
    `${serverUrl}/api/v1/auth/login/second-factor`,
    { method: "POST", body: { challenge_token: challenge, code } },
    fetcher,
  );
  if (!result.tokens) throw new ServerError("Risposta del server non valida", 0, "bad_response");
  return toSession(serverUrl, email, result.tokens);
}

export async function logout(session: SyncSession, fetcher?: typeof fetch): Promise<void> {
  await call(
    `${session.serverUrl}/api/v1/auth/logout`,
    { method: "POST", token: session.accessToken },
    fetcher,
  ).catch(() => undefined); // the local session is dropped either way
}

/**
 * Talks to the server as one signed-in user. It renews the access token before it expires
 * and once more after a 401; the refresh token rotates, so the new pair is handed to
 * `onSession` to be saved before anything else happens.
 */
export class HttpTransport implements Transport {
  constructor(
    private session: SyncSession,
    private readonly deviceId: string,
    private readonly onSession: (session: SyncSession) => Promise<void>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async renew(): Promise<void> {
    if (Date.parse(this.session.refreshExpiresAt) <= this.now()) {
      throw new ServerError("La sessione è scaduta: accedi di nuovo", 401, "session_expired");
    }
    const result = await call<{ tokens?: WireTokens } & Partial<WireTokens>>(
      `${this.session.serverUrl}/api/v1/auth/refresh`,
      { method: "POST", body: { refresh_token: this.session.refreshToken } },
      this.fetcher,
    );
    const tokens = (result.tokens ?? result) as WireTokens;
    this.session = toSession(this.session.serverUrl, this.session.email, tokens);
    await this.onSession(this.session);
  }

  private async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (Date.parse(this.session.accessExpiresAt) - this.now() < 30_000) await this.renew();
    const send = () =>
      call<T>(
        `${this.session.serverUrl}/api/v1${path}`,
        { method, token: this.session.accessToken, ...(body === undefined ? {} : { body }) },
        this.fetcher,
      );
    try {
      return await send();
    } catch (error) {
      if (error instanceof ServerError && error.status === 401) {
        await this.renew();
        return await send();
      }
      throw error;
    }
  }

  async push(operations: WireOperation[]): Promise<WireResult[]> {
    const result = await this.authed<{ results: WireResult[] }>("POST", "/sync/push", {
      device_id: this.deviceId,
      operations,
    });
    return result.results;
  }

  pull(after: number, limit: number): Promise<WirePage> {
    const query = new URLSearchParams({
      device_id: this.deviceId,
      after: String(after),
      limit: String(limit),
    });
    return this.authed<WirePage>("GET", `/sync/pull?${query.toString()}`);
  }
}
