export const ONLINE_INTERVAL_MS = 15_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

/** Delay before the next probe: steady while reachable, exponential backoff while not. */
export function nextDelay(reachable: boolean, consecutiveFailures: number): number {
  if (reachable) return ONLINE_INTERVAL_MS;
  const exponent = Math.max(0, consecutiveFailures - 1);
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
}
