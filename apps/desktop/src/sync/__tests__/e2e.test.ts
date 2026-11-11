// @vitest-environment node
/**
 * End-to-end: two apps against the real server (FastAPI + PostgreSQL). Skipped unless
 * VYRION_E2E_URL, VYRION_E2E_EMAIL and VYRION_E2E_PASSWORD are set.
 *   VYRION_E2E_URL=http://127.0.0.1:8000 pnpm vitest run src/sync/__tests__/e2e.test.ts
 */
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { HttpTransport, login, type SyncSession } from "../api";
import { SyncEngine } from "../engine";

const url = process.env["VYRION_E2E_URL"];
const email = process.env["VYRION_E2E_EMAIL"] ?? "";
const password = process.env["VYRION_E2E_PASSWORD"] ?? "";

describe.skipIf(!url)("real server", () => {
  async function device() {
    const ws = await testWorkspace();
    const outcome = await login(url ?? "", email, password);
    if (outcome.status !== "authenticated") throw new Error("expected a direct login");
    const saved: SyncSession[] = [outcome.session];
    const transport = new HttpTransport(outcome.session, ws.deviceId, async (s) => {
      saved.push(s);
    });
    return { ws, engine: new SyncEngine(ws, transport), saved, transport };
  }

  it("moves data between two devices, merges, conflicts and resolves", async () => {
    const a = await device();
    const b = await device();
    const tag = `e2e-${Date.now()}`;

    const party = await a.ws.create("party", {
      name: `Acme ${tag}`,
      phone: "+39 02 1111111",
      kind: "customer",
    });
    await a.engine.adopt();
    const first = await a.engine.syncNow();
    expect(first.conflicts).toBe(0);

    await b.engine.adopt();
    const got = await b.engine.syncNow();
    expect(got.problems).toEqual([]);
    expect((await b.ws.get("party", party.id))?.["name"]).toBe(`Acme ${tag}`);

    // different fields on both devices: merged by the server
    await b.ws.update("party", party.id, { phone: "+39 02 2222222" });
    await a.ws.update("party", party.id, { name: `Acme Srl ${tag}` });
    await b.engine.syncNow();
    const merged = await a.engine.syncNow();
    expect(merged.merged).toBe(1);
    expect(merged.conflicts).toBe(0);
    await b.engine.syncNow();
    for (const side of [a, b]) {
      const record = await side.ws.get("party", party.id);
      expect(record?.["name"]).toBe(`Acme Srl ${tag}`);
      expect(record?.["phone"]).toBe("+39 02 2222222");
      expect(record?.version).toBe(3);
    }

    // the same field on both: a conflict a person resolves
    await b.ws.update("party", party.id, { name: `From B ${tag}` });
    await a.ws.update("party", party.id, { name: `From A ${tag}` });
    await b.engine.syncNow();
    const clash = await a.engine.syncNow();
    expect(clash.conflicts).toBe(1);
    const [conflict] = await a.engine.conflicts();
    expect(conflict?.reason).toBe("same_fields_changed");
    expect(conflict?.fields).toContain("name");
    await a.engine.resolve(conflict?.id ?? 0, "mine");
    expect((await a.engine.syncNow()).conflicts).toBe(0);
    await b.engine.syncNow();
    expect((await b.ws.get("party", party.id))?.["name"]).toBe(`From A ${tag}`);
  });

  it("renews an expired access token by itself and hands over the rotated pair", async () => {
    const d = await device();
    const stale: SyncSession = {
      ...d.saved[0],
      accessExpiresAt: "2000-01-01T00:00:00Z",
    } as SyncSession;
    const saved: SyncSession[] = [];
    const transport = new HttpTransport(stale, d.ws.deviceId, async (s) => {
      saved.push(s);
    });
    await transport.pull(0, 1);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.refreshToken).not.toBe(stale.refreshToken);
  });
});
