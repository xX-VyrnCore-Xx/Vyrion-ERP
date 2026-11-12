import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { formatMoney } from "../lib/money";
import { stockLevels } from "../modules/reports";
import { MOVEMENT_KINDS } from "../modules/erp";
import {
  expiringLots,
  lotLevels,
  MAIN_WAREHOUSE,
  stockByWarehouse,
  transferStock,
} from "../modules/stock";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay, resolveRefs } from "../ui/format";

const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";

export function InventoryPage() {
  const ws = useWorkspace();
  const [product, setProduct] = useState("");
  const [kind, setKind] = useState("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [lot, setLot] = useState("");
  const [newLot, setNewLot] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [transfer, setTransfer] = useState({ from: "", to: "", quantity: "" });
  const [transferMessage, setTransferMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const data = useAsync(async () => {
    const levels = await stockLevels(ws.db);
    const movements = await ws.list("stock_movement", { limit: 30, orderBy: "date desc" });
    const refs = await resolveRefs(ws, ws.registry.get("stock_movement"), movements.rows);
    const warehouses = (await ws.list("warehouse", { limit: 200, orderBy: "name asc" })).rows.map(
      (w) => ({ id: w.id, name: String(w["name"]) }),
    );
    const byWarehouse = await stockByWarehouse(ws.db);
    const lots = await lotLevels(ws.db);
    const expiring = await expiringLots(ws.db, ws.ctx.today(), 30);
    const lotProducts = new Set(
      (
        (await ws.db.query(
          "SELECT id FROM products WHERE track_lots = 1 AND deleted_at IS NULL",
        )) as unknown as { id: string }[]
      ).map((r) => r.id),
    );
    const allLots = (await ws.list("stock_lot", { limit: 500 })).rows.map((l) => ({
      id: l.id,
      productId: String(l["product_id"]),
      code: String(l["code"]),
    }));
    return {
      levels,
      movements: movements.rows,
      refs,
      warehouses,
      byWarehouse,
      lots,
      expiring,
      lotProducts,
      allLots,
    };
  }, []);

  const tracksLots = data.data?.lotProducts.has(product) ?? false;
  const lotsOfProduct = data.data?.allLots.filter((l) => l.productId === product) ?? [];
  const productName = (id: string): string =>
    data.data?.levels.find((l) => l.productId === id)?.name ?? "";

  const register = async () => {
    setMessage(null);
    const n = Number(quantity.replace(",", "."));
    if (!product || !(n > 0))
      return setMessage("Scegli il prodotto e una quantità maggiore di zero.");
    const signed = kind === "out" ? -n : n;
    try {
      let lotId: string | null = lot || null;
      if (tracksLots && !lotId && newLot.trim()) {
        const created = await ws.create("stock_lot", {
          product_id: product,
          code: newLot.trim(),
          ...(newExpiry ? { expiry_date: newExpiry } : {}),
        });
        lotId = created.id;
      }
      await ws.create("stock_movement", {
        product_id: product,
        date: ws.ctx.today(),
        kind,
        quantity: signed,
        reason: reason || null,
        warehouse_id: warehouse || null,
        lot_id: lotId,
      });
      setQuantity("");
      setReason("");
      setNewLot("");
      setNewExpiry("");
      setLot(lotId ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const move = async () => {
    setTransferMessage(null);
    const n = Number(transfer.quantity.replace(",", "."));
    if (!product || !(n > 0))
      return setTransferMessage({ ok: false, text: "Scegli il prodotto sopra e una quantità." });
    try {
      await transferStock(ws, {
        productId: product,
        fromWarehouseId: transfer.from || null,
        toWarehouseId: transfer.to || null,
        quantity: n,
        lotId: lot || null,
      });
      setTransfer({ ...transfer, quantity: "" });
      setTransferMessage({ ok: true, text: "Trasferimento registrato." });
    } catch (error) {
      setTransferMessage({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const totalValue = data.data?.levels.reduce((s, l) => s + l.value, 0) ?? 0;
  const warehouseOptions = (
    <>
      <option value="">{MAIN_WAREHOUSE}</option>
      {data.data?.warehouses.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </>
  );

  return (
    <>
      <PageHeader
        title="Prodotti e magazzino"
        subtitle="Giacenze per magazzino e per lotto, valorizzate al costo medio ponderato. Le fatture muovono il magazzino da sole."
      />
      <ErrorNote message={data.error} />
      <div className="space-y-4">
        <Card title={`Giacenze · valore al costo medio ${formatMoney(totalValue)}`}>
          {data.data?.levels.length === 0 ? (
            <Empty>
              Nessun prodotto con giacenza attiva.{" "}
              <a className="text-accent hover:underline" href={href("e", "product", "new")}>
                Crea un prodotto
              </a>{" "}
              e attiva «Gestisci giacenza».
            </Empty>
          ) : (
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Codice", "Prodotto"].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                  {["Giacenza", "Scorta minima", "Valore"].map((h) => (
                    <th key={h} scope="col" className={`${TH} text-right`}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={TH}>
                    <span className="sr-only">Stato</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data?.levels.map((l) => (
                  <tr key={l.productId}>
                    <td className={TD}>{l.sku}</td>
                    <td className={TD}>
                      <a
                        className="text-fg hover:text-accent"
                        href={href("e", "product", l.productId)}
                      >
                        {l.name}
                      </a>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{l.onHand}</td>
                    <td className={`${TD} text-right tabular-nums`}>{l.minStock}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMoney(l.value)}</td>
                    <td className={TD}>
                      {l.low ? <Badge tone="warning">Scorta bassa</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {data.data && data.data.byWarehouse.length > 0 ? (
          <Card title="Giacenze per magazzino">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Magazzino
                  </th>
                  <th scope="col" className={TH}>
                    Prodotto
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Giacenza
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Valore
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.byWarehouse
                  .slice()
                  .sort((a, b) => a.warehouse.localeCompare(b.warehouse))
                  .map((r) => (
                    <tr key={`${r.productId}|${r.warehouseId ?? ""}`}>
                      <td className={TD}>{r.warehouse}</td>
                      <td className={TD}>{productName(r.productId)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.onHand}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(r.value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        ) : null}

        {data.data && data.data.lots.length > 0 ? (
          <Card title="Lotti in giacenza">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Prodotto
                  </th>
                  <th scope="col" className={TH}>
                    Lotto
                  </th>
                  <th scope="col" className={TH}>
                    Scadenza
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Giacenza
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Stato</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.lots.map((l) => {
                  const alert = data.data?.expiring.find((e) => e.lotId === l.lotId);
                  return (
                    <tr key={l.lotId}>
                      <td className={TD}>{productName(l.productId)}</td>
                      <td className={TD}>
                        <a
                          className="text-fg hover:text-accent"
                          href={href("e", "stock_lot", l.lotId)}
                        >
                          {l.code}
                        </a>
                      </td>
                      <td className={TD}>{l.expiryDate ? formatDay(l.expiryDate) : "—"}</td>
                      <td className={`${TD} text-right tabular-nums`}>{l.onHand}</td>
                      <td className={TD}>
                        {alert ? (
                          <Badge tone={alert.expired ? "danger" : "warning"}>
                            {alert.expired ? "Scaduto" : "In scadenza"}
                          </Badge>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : null}

        <Card title="Registra un movimento">
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem_9rem_1fr]">
            <select
              aria-label="Prodotto"
              className={input}
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setLot("");
              }}
            >
              <option value="">Prodotto…</option>
              {data.data?.levels.map((l) => (
                <option key={l.productId} value={l.productId}>
                  {l.sku} · {l.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Tipo di movimento"
              className={input}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {MOVEMENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Quantità"
              inputMode="decimal"
              placeholder="Quantità"
              className={input}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <select
              aria-label="Magazzino"
              className={input}
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              {warehouseOptions}
            </select>
          </div>
          {tracksLots ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_10rem]">
              <select
                aria-label="Lotto"
                className={input}
                value={lot}
                onChange={(e) => setLot(e.target.value)}
              >
                <option value="">Lotto esistente…</option>
                {lotsOfProduct.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                  </option>
                ))}
              </select>
              <input
                aria-label="Nuovo lotto"
                placeholder="…oppure nuovo lotto / matricola"
                className={input}
                value={newLot}
                disabled={Boolean(lot)}
                onChange={(e) => setNewLot(e.target.value)}
              />
              <input
                aria-label="Scadenza del nuovo lotto"
                type="date"
                className={input}
                value={newExpiry}
                disabled={Boolean(lot) || !newLot}
                onChange={(e) => setNewExpiry(e.target.value)}
              />
            </div>
          ) : null}
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              aria-label="Motivo"
              placeholder="Motivo"
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button variant="primary" onClick={() => void register()}>
              Registra
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Una rettifica inventariale aggiunge la quantità indicata: per ridurre la giacenza usa
            «Scarico». I magazzini si creano da{" "}
            <a className="text-accent hover:underline" href={href("e", "warehouse")}>
              Magazzini
            </a>
            .
          </p>
          <div className="mt-2">
            <ErrorNote message={message} />
          </div>
        </Card>

        <Card title="Trasferisci tra magazzini">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
            <select
              aria-label="Da magazzino"
              className={input}
              value={transfer.from}
              onChange={(e) => setTransfer({ ...transfer, from: e.target.value })}
            >
              {warehouseOptions}
            </select>
            <select
              aria-label="A magazzino"
              className={input}
              value={transfer.to}
              onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}
            >
              {warehouseOptions}
            </select>
            <input
              aria-label="Quantità da trasferire"
              inputMode="decimal"
              placeholder="Quantità"
              className={input}
              value={transfer.quantity}
              onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })}
            />
            <Button onClick={() => void move()}>Trasferisci</Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Usa il prodotto (e il lotto) scelti qui sopra. Il valore del magazzino non cambia.
          </p>
          {transferMessage ? (
            transferMessage.ok ? (
              <p role="status" className="mt-2 text-sm text-success">
                {transferMessage.text}
              </p>
            ) : (
              <div className="mt-2">
                <ErrorNote message={transferMessage.text} />
              </div>
            )
          ) : null}
        </Card>

        <Card title="Ultimi movimenti">
          <ul className="divide-y divide-line/60 text-sm">
            {data.data?.movements.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  {formatDay(String(m["date"]))} · {data.data?.refs.get(String(m["product_id"]))} ·{" "}
                  {String(m["reason"] ?? "")}
                </span>
                <span className="tabular-nums">
                  {Number(m["quantity"]) > 0 ? "+" : ""}
                  {String(m["quantity"])}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
