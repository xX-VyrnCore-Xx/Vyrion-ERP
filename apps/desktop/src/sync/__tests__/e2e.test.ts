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

  it("keeps working offline, then sends everything once the server is reachable again", async () => {
    const a = await device();
    const b = await device();
    await a.engine.adopt();
    await b.engine.adopt();
    const tag = `offline-${Date.now()}`;

    // The same device, with a server that cannot be reached.
    const down = new SyncEngine(
      a.ws,
      new HttpTransport(
        { ...a.saved[0], serverUrl: "http://127.0.0.1:1" } as SyncSession,
        a.ws.deviceId,
        async () => undefined,
      ),
    );
    const record = await a.ws.create("party", { name: `Creato offline ${tag}`, kind: "customer" });
    await a.ws.update("party", record.id, { phone: "+39 06 0000000" });
    await expect(down.syncNow()).rejects.toMatchObject({ code: "network" });
    expect(await down.pendingCount()).toBeGreaterThan(0);
    expect((await a.ws.get("party", record.id))?.["name"]).toBe(`Creato offline ${tag}`); // nothing lost

    // Back online: the queue drains and the other device receives the record.
    const report = await a.engine.syncNow();
    expect(report.problems).toEqual([]);
    expect(await a.engine.pendingCount()).toBe(0);
    await b.engine.syncNow();
    const there = await b.ws.get("party", record.id);
    expect(there?.["name"]).toBe(`Creato offline ${tag}`);
    expect(there?.["phone"]).toBe("+39 06 0000000");

    // Sending again changes nothing (idempotent): no duplicates.
    expect((await a.engine.syncNow()).sent).toBe(0);
  });

  it("serves the administration console: users, roles, audit, sessions, status, backups", async () => {
    const d = await device();
    const get = <T>(path: string) => d.transport.request<T>("GET", path);
    const users = await get<{ items: { email: string; id: string; version: number }[] }>(
      "/users?limit=50",
    );
    expect(users.items.some((u) => u.email === email)).toBe(true);
    expect((await get<{ key: string }[]>("/roles")).length).toBeGreaterThan(0);
    expect((await get<{ items: unknown[] }>("/audit-log?limit=5")).items.length).toBeGreaterThan(0);
    expect((await get<{ current: boolean }[]>("/auth/sessions")).some((x) => x.current)).toBe(true);
    const status = await get<{ records: number; devices: unknown[] }>("/sync/status");
    expect(status.records).toBeGreaterThanOrEqual(0);
    const backups = await get<{ configured: boolean; stale: boolean }>("/backups");
    expect(backups.stale).toBe(true); // no backup service writes here

    // Invite, give a role, deactivate: the flow of the Users pane.
    const invited = await d.transport.request<{
      user: { id: string; version: number };
      setup_token: string;
    }>("POST", "/users", {
      email: `invited-${Date.now()}@example.com`,
      full_name: "Invitata Prova",
    });
    expect(invited.setup_token.length).toBeGreaterThan(10);
    const withRole = await d.transport.request<{ version: number; roles: { key: string }[] }>(
      "PUT",
      `/users/${invited.user.id}/roles`,
      { version: invited.user.version, roles: ["employee"] },
    );
    expect(withRole.roles.map((r) => r.key)).toEqual(["employee"]);
    const off = await d.transport.request<{ is_active: boolean }>(
      "PATCH",
      `/users/${invited.user.id}`,
      {
        version: withRole.version,
        is_active: false,
      },
    );
    expect(off.is_active).toBe(false);
  });
});
