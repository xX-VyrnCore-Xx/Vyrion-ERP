import { describe, expect, it } from "vitest";

import { kpis, notifications } from "../modules/insights";
import { search } from "../search/engine";
import { testWorkspace } from "../test/workspace";

const N = 3000;

/** Time budgets are generous (several times what a laptop needs): they catch an accidental
 * full scan or an O(n²) loop, not a slow CI machine. */
describe("with a realistic amount of data", () => {
  it("keeps writing, searching and the dashboard fast", async () => {
    const ws = await testWorkspace();
    const timings: Record<string, number> = {};
    const time = async <T>(label: string, job: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      const result = await job();
      timings[label] = Math.round(performance.now() - start);
      return result;
    };

    await time("insert", async () => {
      for (let i = 0; i < N; i++) {
        await ws.create("party", {
          name: `Cliente ${i} Srl`,
          kind: i % 3 === 0 ? "supplier" : "customer",
          email: `cliente${i}@example.com`,
          phone: `+39 02 ${String(1000000 + i)}`,
        });
      }
    });

    await time("search-word", () => search(ws.db, ws.registry, "cliente 1500"));
    const found = await time("search-typo", () => search(ws.db, ws.registry, "clinte 2999"));
    expect(found.results.length).toBeGreaterThan(0);
    await time("search-intent", () => search(ws.db, ws.registry, "nuovo cliente"));
    const today = ws.ctx.today();
    await time("kpis", () => kpis(ws.db, today));
    await time("notifications", () => notifications(ws.db, today, ws.ctx.now()));
    await time("list", () => ws.list("party", { limit: 50 }));

    process.stderr.write(`perf (${N} records, ms): ${JSON.stringify(timings)}\n`);
    expect(timings["insert"]).toBeLessThan(60_000);
    for (const key of ["search-word", "search-typo", "search-intent"])
      expect(timings[key], key).toBeLessThan(1500);
    for (const key of ["kpis", "notifications", "list"])
      expect(timings[key], key).toBeLessThan(1500);
  }, 120_000);
});
