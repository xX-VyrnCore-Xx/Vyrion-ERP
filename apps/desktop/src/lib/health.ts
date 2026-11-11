export type ComponentState = { status: "ok" | "error"; latencyMs: number | null };

export type Readiness =
  | { state: "online" | "degraded"; version: string; components: Record<string, ComponentState> }
  | { state: "offline" };

export const READINESS_PATH = "/api/v1/health/ready";
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Asks the backend whether it and its dependencies are reachable.
 * Never throws: network failures, timeouts and malformed answers all map to "offline",
 * so a captive portal or a foreign host cannot be mistaken for the company server.
 */
export async function fetchReadiness(
  baseUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Readiness> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  try {
    const response = await fetch(`${baseUrl}${READINESS_PATH}`, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200 && response.status !== 503) return { state: "offline" };
    return parseReadiness(await response.json()) ?? { state: "offline" };
  } catch {
    return { state: "offline" };
  }
}

function parseReadiness(body: unknown): Readiness | null {
  if (!isRecord(body) || typeof body.version !== "string" || !isRecord(body.components)) {
    return null;
  }
  if (body.status !== "ok" && body.status !== "degraded") return null;

  const components: Record<string, ComponentState> = {};
  for (const [name, value] of Object.entries(body.components)) {
    if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) return null;
    components[name] = {
      status: value.status,
      latencyMs: typeof value.latency_ms === "number" ? value.latency_ms : null,
    };
  }
  return {
    state: body.status === "ok" ? "online" : "degraded",
    version: body.version,
    components,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
