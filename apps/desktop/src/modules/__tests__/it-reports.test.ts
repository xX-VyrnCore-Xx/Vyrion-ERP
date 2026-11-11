// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ConflictError, ValidationError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import { dismissNotification, globalSearch, kpis, notifications } from "../insights";
import { issueDocument, saveDocument } from "../operations";
import {
  aging,
  bucketOf,
  profitAndLoss,
  stockLevels,
  toCsv,
  trialBalance,
  vatSummary,
} from "../reports";

const KEY = "mK8vFh3x2dQ1pL9wZ7yR5tN4bV6cX0aS2eG8jH1uI3o=";

describe("IT rules", () => {
  it("keeps networks disjoint and IPs inside their network", async () => {
    const ws = await testWorkspace();
    const lan = await ws.create("network", {
      name: "LAN",
      cidr: "192.168.1.0/24",
      gateway: "192.168.1.1",
    });
    await expect(
      ws.create("network", { name: "Bad", cidr: "192.168.1.128/25" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      ws.create("network", { name: "Gw", cidr: "10.0.0.0/24", gateway: "10.0.1.1" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ws.create("ip_address", { network_id: lan.id, address: "10.9.9.9" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await ws.create("ip_address", { network_id: lan.id, address: "192.168.1.10" });
    await expect(
      ws.create("ip_address", { network_id: lan.id, address: "192.168.1.10" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(ws.create("network", { name: "X", cidr: "300.1.1.0/24" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("accepts only WireGuard public keys and CIDR lists", async () => {
    const ws = await testWorkspace();
    await expect(
      ws.create("vpn_peer", { name: "a", public_key: "not-a-key", allowed_ips: "10.8.0.2/32" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ws.create("vpn_peer", { name: "a", public_key: KEY, allowed_ips: "10.8.0.2" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ws.create("vpn_peer", {
        name: "a",
        public_key: KEY,
        allowed_ips: "10.8.0.2/32, fd00::2/128",
      }),
    ).resolves.toBeTruthy();
  });

  it("checks licence seats, warranty dates and security resolutions", async () => {
    const ws = await testWorkspace();
    await expect(
      ws.create("license", { product: "Office", seats: 5, used_seats: 6 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ws.create("asset", {
        tag: "A1",
        name: "PC",
        purchase_date: "2026-05-01",
        warranty_until: "2026-01-01",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ws.create("security_event", {
        occurred_at: "2026-01-01T10:00:00Z",
        summary: "x",
        status: "resolved",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

async function withInvoices() {
  const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
  const customer = await ws.create("party", {
    name: "Cliente",
    kind: "customer",
    payment_terms_days: 30,
  });
  const supplier = await ws.create("party", { name: "Fornitore", kind: "supplier" });
  const sale = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: { type: "invoice", date: "2026-04-01", party_id: customer.id },
      lines: [{ description: "x", quantity: 1, unit_price: 100000, vat_rate: 22 }],
    }),
  );
  await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, sale.id, "2026-04-01"));
  const buy = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: {
        type: "purchase_invoice",
        number: "F-77",
        date: "2026-04-05",
        party_id: supplier.id,
      },
      lines: [{ description: "y", quantity: 1, unit_price: 30000, vat_rate: 22 }],
    }),
  );
  await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, buy.id, "2026-04-05"));
  return { ws, customer, sale };
}

describe("reports", () => {
  it("builds the trial balance, P&L and VAT settlement from the ledger and documents", async () => {
    const { ws } = await withInvoices();
    const tb = await trialBalance(ws.db, "2026-01-01", "2026-12-31");
    expect(tb.reduce((s, r) => s + r.balance, 0)).toBe(0);
    const pl = await profitAndLoss(ws.db, "2026-01-01", "2026-12-31");
    expect(pl).toEqual({ revenue: 100000, expenses: 30000, result: 70000 });
    const vat = await vatSummary(ws.db, "2026-04-01", "2026-06-30");
    expect([vat.salesVat, vat.purchaseVat, vat.balance]).toEqual([22000, 6600, 15400]);
    expect((await vatSummary(ws.db, "2026-01-01", "2026-03-31")).balance).toBe(0);
  });

  it("ages receivables into overdue buckets and drops them once paid", async () => {
    const { ws, sale } = await withInvoices();
    const rows = await aging(ws.db, "2026-06-15", "receivable");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dueDate: "2026-05-01",
      outstanding: 122000,
      daysOverdue: 45,
      bucket: "31-60",
    });
    await ws.create("payment", { document_id: sale.id, date: "2026-06-15", amount: 122000 });
    expect(await aging(ws.db, "2026-06-15", "receivable")).toHaveLength(0);
    expect(bucketOf(0)).toBe("not_due");
    expect(bucketOf(91)).toBe("90+");
  });

  it("reports stock levels with low-stock flag", async () => {
    const ws = await testWorkspace();
    const p = await ws.create("product", {
      sku: "S",
      name: "Cavo",
      track_stock: true,
      min_stock: 5,
      purchase_price: 200,
    });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: ws.ctx.today(),
      kind: "in",
      quantity: 4,
    });
    expect(await stockLevels(ws.db)).toEqual([
      expect.objectContaining({ onHand: 4, low: true, value: 800 }),
    ]);
  });

  it("exports CSV safely for spreadsheets", () => {
    const csv = toCsv(
      [
        { key: "a", label: "Nome" },
        { key: "b", label: "Importo" },
      ],
      [
        { a: '=HYPERLINK("x")', b: 12.5 },
        { a: 'Rossi; "Mario"', b: null },
      ],
    );
    expect(csv.startsWith("﻿Nome;Importo\r\n")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("12,5");
    expect(csv).toContain('"Rossi; ""Mario"""');
  });
});

describe("insights", () => {
  it("raises notifications from real data and honours dismissal", async () => {
    const { ws } = await withInvoices();
    const today = "2026-06-15";
    const now = "2026-06-15T10:00:00Z";
    const net = await ws.create("asset", { tag: "SRV1", name: "Server" });
    await ws.create("backup_job", { name: "Notturno", asset_id: net.id, expected_every_hours: 24 });
    await ws.create("security_event", {
      occurred_at: now,
      summary: "Accesso sospetto",
      severity: "critical",
      category: "access",
    });
    await ws.create("task", { title: "Chiama", due_date: "2026-06-10" });
    const list = await notifications(ws.db, today, now);
    const titles = list.map((n) => n.title);
    expect(titles).toContain("Backup: Notturno");
    expect(titles.some((t) => t.startsWith("Fattura FT 2026/0001 scaduta"))).toBe(true);
    expect(titles).toContain("Evento di sicurezza critico");
    expect(titles).toContain("Attività: Chiama");
    expect(list[0]?.severity).toBe("danger");

    const backup = list.find((n) => n.title === "Backup: Notturno");
    await dismissNotification(ws.db, backup?.key ?? "", now);
    expect(
      (await notifications(ws.db, today, now)).some((n) => n.title === "Backup: Notturno"),
    ).toBe(false);

    const job = (await ws.list("backup_job")).rows[0];
    await ws.create("backup_run", {
      job_id: job?.id,
      finished_at: "2026-06-15T02:00:00Z",
      status: "success",
    });
    expect(
      (await notifications(ws.db, today, now)).some((n) => n.title === "Backup: Notturno"),
    ).toBe(false);
  });

  it("searches across entities without treating wildcards literally", async () => {
    const { ws } = await withInvoices();
    await ws.create("asset", { tag: "PC-100%", name: "Portatile" });
    const hits = await globalSearch(ws.db, ws.registry, "cliente");
    expect(hits.some((h) => h.entity === "party")).toBe(true);
    expect((await globalSearch(ws.db, ws.registry, "100%")).map((h) => h.entity)).toEqual([
      "asset",
    ]);
    expect(await globalSearch(ws.db, ws.registry, "a")).toEqual([]);
  });

  it("computes dashboard figures", async () => {
    const { ws } = await withInvoices();
    const k = await kpis(ws.db, "2026-06-15");
    expect(k).toMatchObject({
      receivables: 122000,
      overdue: 122000,
      payables: 36600,
      revenueYtd: 100000,
    });
  });
});
