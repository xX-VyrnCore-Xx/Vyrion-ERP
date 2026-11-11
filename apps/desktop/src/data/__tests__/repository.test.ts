// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, LockedError, ValidationError, VersionConflictError } from "../errors";
import type { EntityDef } from "../entity";
import { openMemoryDatabase } from "../memoryDriver";
import { Registry } from "../registry";
import { Workspace } from "../workspace";
import { createTableSql } from "../entity";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const wasmDir = dirname(createRequire(import.meta.url).resolve("sql.js"));

const customer: EntityDef = {
  key: "customer",
  module: "crm",
  label: "Cliente",
  plural: "Clienti",
  table: "customers",
  title: (r) => String(r["name"]),
  fields: [
    { name: "name", label: "Nome", type: "text", required: true, searchable: true, list: true },
    { name: "email", label: "Email", type: "email", unique: true },
    { name: "active", label: "Attivo", type: "boolean", default: true },
    { name: "secret", label: "Segreto", type: "text", sensitive: true },
  ],
};
const order: EntityDef = {
  key: "order",
  module: "erp",
  label: "Ordine",
  plural: "Ordini",
  table: "orders",
  title: (r) => String(r["number"]),
  lockedReason: (r) => (r["status"] === "closed" ? "Ordine chiuso" : null),
  fields: [
    { name: "number", label: "Numero", type: "text", required: true },
    { name: "customer_id", label: "Cliente", type: "ref", ref: "customer", required: true },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: [
        { value: "open", label: "Aperto" },
        { value: "closed", label: "Chiuso" },
      ],
      default: "open",
    },
    { name: "total", label: "Totale", type: "money", default: 0 },
  ],
};

async function open(sync = false) {
  const db = await openMemoryDatabase((f) => join(wasmDir, f));
  const ws = await Workspace.open({
    db,
    entities: [customer, order],
    migrations: (reg: Registry) => [
      {
        id: 2,
        name: "entities",
        statements: reg.entities.flatMap((d) => createTableSql(d, reg.tableOf)),
      },
    ],
  });
  if (sync) await ws.setSyncEnabled(true);
  return ws;
}

describe("repository", () => {
  let ws: Workspace;
  beforeEach(async () => {
    ws = await open();
  });

  it("creates, reads and normalises", async () => {
    const c = await ws.create("customer", { name: "  Acme  ", email: "INFO@Acme.it" });
    expect(c.version).toBe(1);
    const got = await ws.get("customer", c.id);
    expect(got?.["name"]).toBe("Acme");
    expect(got?.["email"]).toBe("info@acme.it");
    expect(got?.["active"]).toBe(true);
  });

  it("rejects invalid input with field errors", async () => {
    await expect(ws.create("customer", { name: "", email: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(ws.create("customer", { name: "a", bogus: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("enforces uniqueness among live records only", async () => {
    const a = await ws.create("customer", { name: "A", email: "a@x.it" });
    await expect(ws.create("customer", { name: "B", email: "a@x.it" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await ws.remove("customer", a.id);
    await expect(ws.create("customer", { name: "B", email: "a@x.it" })).resolves.toBeTruthy();
  });

  it("updates with optimistic locking", async () => {
    const c = await ws.create("customer", { name: "A" });
    const u = await ws.update("customer", c.id, { name: "B" }, 1);
    expect(u.version).toBe(2);
    await expect(ws.update("customer", c.id, { name: "C" }, 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    const same = await ws.update("customer", c.id, { name: "B" });
    expect(same.version).toBe(2); // no-op does not bump the version
  });

  it("checks references on write and refuses deleting a record in use", async () => {
    await expect(
      ws.create("order", { number: "1", customer_id: "00000000-0000-7000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const c = await ws.create("customer", { name: "A" });
    const o = await ws.create("order", { number: "1", customer_id: c.id });
    await expect(ws.remove("customer", c.id)).rejects.toBeInstanceOf(ConflictError);
    await ws.remove("order", o.id);
    await expect(ws.remove("customer", c.id)).resolves.toBeUndefined();
  });

  it("locks final records", async () => {
    const c = await ws.create("customer", { name: "A" });
    const o = await ws.create("order", { number: "1", customer_id: c.id });
    await ws.update("order", o.id, { status: "closed" });
    await expect(ws.update("order", o.id, { total: 5 })).rejects.toBeInstanceOf(LockedError);
    await expect(ws.remove("order", o.id)).rejects.toBeInstanceOf(LockedError);
  });

  it("lists with search, filters, paging and safe ordering", async () => {
    for (const n of ["Alfa", "Beta", "100%_x", "Gamma"]) await ws.create("customer", { name: n });
    expect((await ws.list("customer")).total).toBe(4);
    expect((await ws.list("customer", { search: "alf" })).rows).toHaveLength(1);
    expect((await ws.list("customer", { search: "%" })).rows).toHaveLength(1); // literal, not wildcard
    const page = await ws.list("customer", { orderBy: "name asc", limit: 2, offset: 1 });
    expect(page.rows.map((r) => r["name"])).toEqual(["Alfa", "Beta"]);
    await expect(ws.list("customer", { orderBy: "name; DROP TABLE customers" })).rejects.toThrow();
    await expect(ws.list("customer", { filters: { nope: 1 } })).rejects.toThrow();
  });

  it("writes an audit trail, masking sensitive fields, and keeps it append-only", async () => {
    const c = await ws.create("customer", { name: "A", secret: "hunter2" });
    await ws.update("customer", c.id, { name: "B" });
    await ws.remove("customer", c.id);
    const rows = await ws.db.query<{ action: string; changes: string }>(
      "SELECT action, changes FROM audit_log ORDER BY seq",
    );
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect(rows[0]?.changes).not.toContain("hunter2");
    await expect(ws.db.execute("UPDATE audit_log SET actor = 'x'")).rejects.toThrow(/append-only/);
    await expect(ws.db.execute("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
  });

  it("rolls back everything when a transaction fails", async () => {
    await expect(
      ws.transact(async (tx, ctx, repo) => {
        await repo("customer").create(tx, ctx, { name: "A" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await ws.list("customer")).total).toBe(0);
    expect((await ws.db.query("SELECT 1 FROM audit_log")).length).toBe(0);
  });

  it("queues sync operations only when linked to a server", async () => {
    const c = await ws.create("customer", { name: "A" });
    expect(await ws.db.query("SELECT 1 FROM sync_outbox")).toHaveLength(0);
    await ws.setSyncEnabled(true);
    await ws.update("customer", c.id, { name: "B" });
    await ws.remove("customer", c.id);
    const ops = await ws.db.query<{ kind: string; base_version: number }>(
      "SELECT kind, base_version FROM sync_outbox ORDER BY seq",
    );
    expect(ops).toEqual([
      { kind: "update", base_version: 1 },
      { kind: "delete", base_version: 2 },
    ]);
  });
});

describe("registry", () => {
  it("rejects broken definitions", () => {
    expect(() => new Registry([customer, customer])).toThrow(/Duplicate/);
    expect(() => new Registry([order])).toThrow(/unknown entity/);
    const clash: EntityDef = { ...customer, fields: [{ name: "id", label: "x", type: "text" }] };
    expect(() => new Registry([clash])).toThrow(/system column/);
  });
});

describe("workspace", () => {
  it("keeps a stable device id and remembers settings across reopen", async () => {
    const ws = await open();
    const again = await Workspace.open({
      db: ws.db,
      entities: [customer, order],
      migrations: (r) => [
        {
          id: 2,
          name: "entities",
          statements: r.entities.flatMap((d) => createTableSql(d, r.tableOf)),
        },
      ],
    });
    expect(again.deviceId).toBe(ws.deviceId);
  });
});
