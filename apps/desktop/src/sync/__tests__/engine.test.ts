// @vitest-environment node
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import type { Transport, WireChange, WireOperation, WirePage, WireResult } from "../api";
import { SyncEngine } from "../engine";

/** A tiny server with the same rules as the real one (exact version applies, anything else conflicts). */
class FakeServer {
  records = new Map<
    string,
    {
      entity: string;
      version: number;
      deleted: boolean;
      data: Record<string, unknown>;
      seq: number;
      device: string | null;
    }
  >();
  seq = 0;
  pushes: WireOperation[][] = [];
  seen = new Map<string, number>();

  for(device: string): Transport {
    return {
      push: async (ops) => {
        this.pushes.push(ops);
        return ops.map((op) => this.apply(device, op));
      },
      pull: async (after, limit): Promise<WirePage> => {
        const all = [...this.records.entries()]
          .filter(([, r]) => r.seq > after && r.device !== device)
          .sort((a, b) => a[1].seq - b[1].seq);
        const page = all.slice(0, limit);
        const changes: WireChange[] = page.map(([id, r]) => ({
          seq: r.seq,
          entity: r.entity,
          entity_id: id,
          version: r.version,
          deleted: r.deleted,
          data: r.data,
        }));
        return {
          changes,
          cursor: all.length > limit ? (page.at(-1)?.[1].seq ?? after) : Math.max(after, this.seq),
          has_more: all.length > limit,
        };
      },
    };
  }

  private apply(device: string, op: WireOperation): WireResult {
    const dup = this.seen.get(op.op_id);
    if (dup !== undefined)
      return {
        op_id: op.op_id,
        status: "duplicate",
        version: dup,
        reason: null,
        conflicting_fields: [],
        server: null,
      };
    const rec = this.records.get(op.entity_id);
    const snapshot = rec
      ? {
          entity: op.entity,
          entity_id: op.entity_id,
          version: rec.version,
          deleted: rec.deleted,
          data: rec.data,
        }
      : null;
    const conflict = (reason: string): WireResult => ({
      op_id: op.op_id,
      status: "conflict",
      version: null,
      reason,
      conflicting_fields: Object.keys(op.payload),
      server: snapshot,
    });
    let version: number;
    if (op.kind === "create") {
      if (rec) return conflict("already_exists");
      version = op.version ?? 1;
      this.records.set(op.entity_id, {
        entity: op.entity,
        version,
        deleted: false,
        data: op.payload,
        seq: ++this.seq,
        device,
      });
    } else {
      if (!rec) return conflict("missing");
      if (rec.deleted) return conflict("deleted");
      if (op.base_version !== rec.version) return conflict("same_fields_changed");
      version = rec.version + 1;
      this.records.set(op.entity_id, {
        ...rec,
        version,
        deleted: op.kind === "delete",
        data: op.kind === "update" ? { ...rec.data, ...op.payload } : rec.data,
        seq: ++this.seq,
        device,
      });
    }
    this.seen.set(op.op_id, version);
    return {
      op_id: op.op_id,
      status: "applied",
      version,
      reason: null,
      conflicting_fields: [],
      server: null,
    };
  }
}

async function pair() {
  const server = new FakeServer();
  const a = await testWorkspace();
  const b = await testWorkspace();
  return {
    server,
    a,
    b,
    ea: new SyncEngine(a, server.for(a.deviceId)),
    eb: new SyncEngine(b, server.for(b.deviceId)),
  };
}

describe("first connection", () => {
  it("queues every existing record once and sends it", async () => {
    const { server, a, ea } = await pair();
    const party = await a.create("party", { name: "Acme", kind: "customer" });
    expect((await a.db.query("SELECT 1 FROM sync_outbox")).length).toBe(0); // nothing queued before linking

    const queued = await ea.adopt();
    expect(queued).toBeGreaterThanOrEqual(13); // the party plus the reference data seeded at start
    expect(await ea.adopt()).toBe(0); // idempotent
    const report = await ea.syncNow();
    expect(report.conflicts).toBe(0);
    expect(report.sent).toBe(queued);
    expect(server.records.get(party.id)?.data["name"]).toBe("Acme");
    expect(await ea.pendingCount()).toBe(0);
  });

  it("a second device receives the data and then edits flow both ways", async () => {
    const { a, b, ea, eb } = await pair();
    const party = await a.create("party", { name: "Acme", phone: "+39 02 1234567" });
    await ea.adopt();
    await ea.syncNow();
    await eb.adopt();
    const first = await eb.syncNow();
    expect(first.received).toBeGreaterThan(0);
    expect((await b.get("party", party.id))?.["name"]).toBe("Acme");

    await b.update("party", party.id, { name: "Acme Srl" });
    await eb.syncNow();
    await ea.syncNow();
    const onA = await a.get("party", party.id);
    expect(onA?.["name"]).toBe("Acme Srl");
    expect(onA?.version).toBe(2);
    // receiving does not queue anything to send back
    expect(await ea.pendingCount()).toBe(0);
  });
});

describe("pushing", () => {
  it("sends several edits of one record in order and keeps versions consistent", async () => {
    const { server, a, ea } = await pair();
    const p = await a.create("party", { name: "v1" });
    await ea.adopt();
    await ea.syncNow();
    await a.update("party", p.id, { name: "v2" });
    await a.update("party", p.id, { name: "v3" });
    const report = await ea.syncNow();
    expect(report.sent).toBe(2);
    expect(server.records.get(p.id)).toMatchObject({ version: 3, data: { name: "v3" } });
  });

  it("does not resend what was already accepted", async () => {
    const { server, a, ea } = await pair();
    await a.create("party", { name: "x" });
    await ea.adopt();
    await ea.syncNow();
    const sentBefore = server.pushes.length;
    await ea.syncNow();
    expect(server.pushes.length).toBe(sentBefore);
  });
});

describe("conflicts", () => {
  async function conflicting() {
    const ctx = await pair();
    const p = await ctx.a.create("party", { name: "Acme", phone: "+39 02 1111111" });
    await ctx.ea.adopt();
    await ctx.ea.syncNow();
    await ctx.eb.adopt();
    await ctx.eb.syncNow();
    await ctx.b.update("party", p.id, { name: "From B" });
    await ctx.eb.syncNow();
    await ctx.a.update("party", p.id, { name: "From A" }); // based on version 1, server is at 2
    await ctx.a.update("party", p.id, { phone: "+39 02 2222222" }); // queued behind it
    const report = await ctx.ea.syncNow();
    return { ...ctx, p, report };
  }

  it("keeps the local edit, records the conflict and holds later edits behind it", async () => {
    const { a, ea, p, report } = await conflicting();
    expect(report.conflicts).toBe(1);
    expect((await a.get("party", p.id))?.["name"]).toBe("From A"); // local value untouched
    const [c] = await ea.conflicts();
    expect(c).toMatchObject({
      entity: "party",
      entityId: p.id,
      reason: "same_fields_changed",
      canKeepMine: true,
    });
    expect(c?.server?.data["name"]).toBe("From B");
    expect(await ea.pendingCount()).toBe(1); // the blocked second edit
    // a later sync must not overwrite the local value with the server's while it waits
    const again = await ea.syncNow();
    expect(again.deferred).toBeGreaterThan(0);
    expect((await a.get("party", p.id))?.["name"]).toBe("From A");
  });

  it("'keep mine' sends the edit on top of the server version, then the held ones", async () => {
    const { server, ea, p } = await conflicting();
    const [c] = await ea.conflicts();
    await ea.resolve(c?.id ?? 0, "mine");
    const report = await ea.syncNow();
    expect(report.conflicts).toBe(0);
    expect(server.records.get(p.id)).toMatchObject({
      version: 4,
      data: { name: "From A", phone: "+39 02 2222222" },
    });
    expect(await ea.conflicts()).toEqual([]);
  });

  it("'use the server' drops the local edits and takes the server copy", async () => {
    const { a, ea, p } = await conflicting();
    const [c] = await ea.conflicts();
    await ea.resolve(c?.id ?? 0, "server");
    const local = await a.get("party", p.id);
    expect(local?.["name"]).toBe("From B");
    expect(local?.version).toBe(2);
    expect(await ea.pendingCount()).toBe(0);
    expect((await ea.syncNow()).conflicts).toBe(0);
  });
});

describe("receiving", () => {
  it("refuses data that does not satisfy the rules instead of storing it", async () => {
    const { server, a, ea } = await pair();
    server.records.set("018f0000-0000-7000-8000-0000000000aa", {
      entity: "party",
      version: 1,
      deleted: false,
      data: { name: "", email: "nope" },
      seq: ++server.seq,
      device: "other",
    });
    server.records.set("018f0000-0000-7000-8000-0000000000bb", {
      entity: "from_the_future",
      version: 1,
      deleted: false,
      data: {},
      seq: ++server.seq,
      device: "other",
    });
    const report = await ea.syncNow();
    expect(report.received).toBe(0);
    expect(report.problems).toHaveLength(2);
    expect((await a.list("party")).total).toBe(0);
  });

  it("applies deletions", async () => {
    const { a, b, ea, eb } = await pair();
    const p = await a.create("party", { name: "Gone" });
    await ea.adopt();
    await ea.syncNow();
    await eb.adopt();
    await eb.syncNow();
    await a.remove("party", p.id);
    await ea.syncNow();
    await eb.syncNow();
    expect(await b.get("party", p.id)).toBeNull();
  });
});

describe("disconnecting", () => {
  it("stops queueing and drops what was waiting, keeping the data", async () => {
    const { a, ea } = await pair();
    await a.create("party", { name: "Keep" });
    await ea.adopt();
    await ea.disconnect();
    expect(await ea.pendingCount()).toBe(0);
    await a.create("party", { name: "After" });
    expect((await a.db.query("SELECT 1 FROM sync_outbox WHERE status = 'pending'")).length).toBe(0);
    expect((await a.list("party")).total).toBe(2);
  });
});
