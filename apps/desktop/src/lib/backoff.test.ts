import { describe, expect, it } from "vitest";

import { nextDelay, ONLINE_INTERVAL_MS } from "./backoff";

describe("nextDelay", () => {
  it("polls at a steady interval while reachable", () => {
    expect(nextDelay(true, 0)).toBe(ONLINE_INTERVAL_MS);
  });

  it("backs off exponentially and caps at 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => nextDelay(false, n))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});
