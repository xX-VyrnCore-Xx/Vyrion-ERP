import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { formatMoney } from "../lib/money";
import { stockLevels } from "../modules/reports";
import { MOVEMENT_KINDS } from "../modules/erp";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay, resolveRefs } from "../ui/format";

export function InventoryPage() {
  const ws = useWorkspace();
  const [product, setProduct] = useState("");
  const [kind, setKind] = useState("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const data = useAsync(async () => {
    const levels = await stockLevels(ws.db);
    const movements = await ws.list("stock_movement", { limit: 30, orderBy: "date desc" });
    const refs = await resolveRefs(ws, ws.registry.get("stock_movement"), movements.rows);
    return { levels, movements: movements.rows, refs };
  }, []);

  const register = async () => {
    setMessage(null);
    const n = Number(quantity.replace(",", "."));
    if (!product || !(n > 0))
      return setMessage("Scegli il prodotto e una quantità maggiore di zero.");
    const signed = kind === "out" ? -n : kind === "adjust" ? n : n;
    try {
      await ws.create("stock_movement", {
        product_id: product,
        date: ws.ctx.today(),
        kind,
        quantity: signed,
        reason: reason || null,
      });
      setQuantity("");
      setReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
  const totalValue = data.data?.levels.reduce((s, l) => s + l.value, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Prodotti e magazzino"
        subtitle="Giacenze dei prodotti con gestione di magazzino. Le fatture muovono il magazzino da sole."
      />
      <ErrorNote message={data.error} />
      <div className="space-y-4">
        <Card title={`Giacenze · valore ${formatMoney(totalValue)}`}>
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

        <Card title="Registra un movimento">
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem_8rem_1fr_auto]">
            <select
              aria-label="Prodotto"
              className={input}
              value={product}
              onChange={(e) => setProduct(e.target.value)}
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
            «Scarico».
          </p>
          <div className="mt-2">
            <ErrorNote message={message} />
          </div>
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
