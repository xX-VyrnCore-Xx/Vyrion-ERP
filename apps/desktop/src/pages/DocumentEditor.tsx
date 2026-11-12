import { useState } from "react";

import { Button } from "../components/Button";
import { buildDocumentPdf } from "../modules/documentPdf";
import { saveText } from "../ui/saveText";
import { Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import type { Rec } from "../data/entity";
import { AppError, ValidationError } from "../data/errors";
import { centsToPlain, formatMoney, parseMoney } from "../lib/money";
import { getCompany } from "../modules/company";
import {
  ALLOWED_STATUS,
  computeTotals,
  DOC_STATUS,
  isFiscal,
  VAT_NATURES,
  type DocType,
} from "../modules/documents";
import { outstanding } from "../modules/erp";
import {
  convertDocument,
  issueDocument,
  saveDocument,
  type DocumentLineInput,
} from "../modules/operations";
import { PAYMENT_METHODS } from "../modules/erp";
import { AttachmentsPanel } from "../ui/AttachmentsPanel";
import { formatDay } from "../ui/format";
import { HistoryPanel } from "../ui/HistoryPanel";
import { ConfirmDialog, ErrorNote, TABLE, TD, TH } from "../ui/parts";

const CONTROL =
  "w-full rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg disabled:opacity-60";
const TITLE: Record<string, string> = {
  quote: "Preventivo",
  order: "Ordine",
  invoice: "Fattura",
  credit_note: "Nota di credito",
  purchase_invoice: "Fattura di acquisto",
};

interface LineState {
  key: number;
  product_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount: string;
  vat_rate: string;
  vat_nature: string;
}

let counter = 0;
const blankLine = (vat: number): LineState => ({
  key: ++counter,
  product_id: "",
  description: "",
  quantity: "1",
  unit: "",
  unit_price: "",
  discount: "0",
  vat_rate: String(vat),
  vat_nature: "",
});

function num(text: string): number {
  return Number(text.replace(",", "."));
}

function toInputs(lines: LineState[]): { inputs: DocumentLineInput[]; problem: string | null } {
  const inputs: DocumentLineInput[] = [];
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    const price = line.unit_price.trim() === "" ? 0 : parseMoney(line.unit_price);
    if (!line.description.trim()) return { inputs, problem: `Riga ${n}: manca la descrizione` };
    if (price === null) return { inputs, problem: `Riga ${n}: prezzo non valido` };
    if (!(num(line.quantity) > 0))
      return { inputs, problem: `Riga ${n}: la quantità deve essere maggiore di zero` };
    const discount = num(line.discount || "0");
    const vat = num(line.vat_rate || "0");
    if (!(discount >= 0 && discount <= 100))
      return { inputs, problem: `Riga ${n}: sconto non valido` };
    if (!(vat >= 0 && vat <= 100)) return { inputs, problem: `Riga ${n}: aliquota IVA non valida` };
    inputs.push({
      product_id: line.product_id || null,
      description: line.description.trim(),
      quantity: num(line.quantity),
      unit: line.unit.trim() || null,
      unit_price: price,
      discount,
      vat_rate: vat,
      vat_nature: line.vat_nature || null,
    });
  }
  return { inputs, problem: null };
}

export function DocumentEditor({
  type,
  id,
  go,
}: {
  type: string;
  id: string;
  go: (to: string) => void;
}) {
  const ws = useWorkspace();
  const creating = id === "new";
  const loaded = useAsync(async () => {
    const company = await getCompany(ws.db);
    const parties = (await ws.list("party", { limit: 1000, orderBy: "name asc" })).rows;
    const products = (await ws.list("product", { limit: 1000, orderBy: "name asc" })).rows;
    const doc = creating ? null : await ws.get("document", id);
    const lines = doc
      ? (
          await ws.list("document_line", {
            filters: { document_id: id },
            orderBy: "position asc",
            limit: 1000,
          })
        ).rows
      : [];
    const payments = doc
      ? (
          await ws.list("payment", {
            filters: { document_id: id },
            orderBy: "date asc",
            limit: 500,
          })
        ).rows
      : [];
    const open = doc ? await outstanding(ws.db, id) : 0;
    return { company, parties, products, doc, lines, payments, open };
  }, [id]);

  if (loaded.loading) return <p className="text-sm text-muted">Caricamento…</p>;
  if (!loaded.data) return <ErrorNote message={loaded.error} />;
  if (!loaded.data.company) {
    return (
      <div className="space-y-3">
        <ErrorNote message="Prima di creare documenti completa i dati dell'azienda (regime fiscale incluso)." />
        <Button variant="primary" onClick={() => go("settings")}>
          Apri le impostazioni
        </Button>
      </div>
    );
  }
  if (!creating && !loaded.data.doc) return <ErrorNote message="Documento non trovato." />;
  return (
    <EditorBody
      key={`${id}:${loaded.data.doc?.version ?? 0}:${loaded.data.lines.length}`}
      type={type}
      data={{ ...loaded.data, company: loaded.data.company }}
      go={go}
    />
  );
}

interface Data {
  company: { regime: "forfettario" | "ordinario"; default_vat_rate: number };
  parties: Rec[];
  products: Rec[];
  doc: Rec | null;
  lines: Rec[];
  payments: Rec[];
  open: number;
}

function EditorBody({ type, data, go }: { type: string; data: Data; go: (to: string) => void }) {
  const ws = useWorkspace();
  const { doc, company } = data;
  const docType = type as DocType;
  const fiscal = isFiscal(type);
  const locked = Boolean(doc && ws.registry.get("document").lockedReason?.(doc));
  const regime = (doc?.["tax_regime"] as "forfettario" | "ordinario" | undefined) ?? company.regime;

  const [partyId, setPartyId] = useState(String(doc?.["party_id"] ?? ""));
  const [date, setDate] = useState(String(doc?.["date"] ?? ws.ctx.today()));
  const [dueDate, setDueDate] = useState(String(doc?.["due_date"] ?? ""));
  const [number, setNumber] = useState(String(doc?.["number"] ?? ""));
  const [notes, setNotes] = useState(String(doc?.["notes"] ?? ""));
  const [lines, setLines] = useState<LineState[]>(() =>
    data.lines.length
      ? data.lines.map((l) => ({
          key: ++counter,
          product_id: String(l["product_id"] ?? ""),
          description: String(l["description"]),
          quantity: String(l["quantity"]),
          unit: String(l["unit"] ?? ""),
          unit_price: centsToPlain(Number(l["unit_price"])).replace(".", ","),
          discount: String(l["discount"] ?? 0),
          vat_rate: String(l["vat_rate"]),
          vat_nature: String(l["vat_nature"] ?? ""),
        }))
      : [blankLine(company.default_vat_rate)],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);

  const parsed = toInputs(lines);
  const totals = parsed.problem ? null : computeTotals(parsed.inputs, regime);

  const fail = (error: unknown) => {
    if (error instanceof ValidationError) setMessage(Object.values(error.errors).join(" · "));
    else
      setMessage(
        error instanceof AppError || error instanceof Error ? error.message : String(error),
      );
  };
  const run = async (job: () => Promise<void>) => {
    setMessage(null);
    setBusy(true);
    try {
      await job();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<Rec | null> => {
    if (parsed.problem) {
      setMessage(parsed.problem);
      return null;
    }
    const header: Record<string, unknown> = {
      type,
      date,
      party_id: partyId || null,
      due_date: dueDate || null,
      notes: notes || null,
    };
    if (type === "purchase_invoice") header["number"] = number || null;
    const saved = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, { ...(doc ? { id: doc.id } : {}), header, lines: parsed.inputs }),
    );
    return saved;
  };

  const downloadPdf = async () => {
    if (!doc) return;
    setMessage(null);
    try {
      const pdf = await buildDocumentPdf(ws, doc.id);
      await saveText(pdf.fileName, pdf.content, "application/pdf");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const onSave = () =>
    run(async () => {
      const saved = await save();
      if (saved && !doc) go(href("d", type, saved.id));
    });

  const onIssue = () =>
    run(async () => {
      setConfirmIssue(false);
      const saved = await save();
      if (!saved) return;
      const issued = await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, saved.id));
      if (!doc) go(href("d", type, issued.id));
    });

  const convert = (to: "order" | "invoice") =>
    run(async () => {
      if (!doc) return;
      const created = await ws.transact((tx, ctx, repo) =>
        convertDocument(tx, ctx, repo, doc.id, to),
      );
      go(href("d", to, created.id));
    });

  const creditNote = () =>
    run(async () => {
      if (!doc) return;
      const created = await ws.transact((tx, ctx, repo) =>
        saveDocument(tx, ctx, repo, {
          header: {
            type: "credit_note",
            date: ctx.today(),
            party_id: doc["party_id"],
            source_id: doc.id,
            notes: `Storno/rettifica della fattura ${String(doc["number"])}`,
          },
          lines: parsed.inputs,
        }),
      );
      go(href("d", "credit_note", created.id));
    });

  const setStatus = (status: string) =>
    run(async () => {
      if (doc) await ws.update("document", doc.id, { status }, doc.version);
    });

  const updateLine = (key: number, patch: Partial<LineState>) =>
    setLines((s) => s.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: number, productId: string) => {
    const product = data.products.find((p) => p.id === productId);
    updateLine(
      key,
      product
        ? {
            product_id: productId,
            description: String(product["name"]),
            unit: String(product["unit"] ?? ""),
            unit_price: centsToPlain(
              type === "purchase_invoice"
                ? Number(product["purchase_price"])
                : Number(product["sale_price"]),
            ).replace(".", ","),
            vat_rate: String(product["vat_rate"] ?? company.default_vat_rate),
          }
        : { product_id: "" },
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <header>
          <a href={`#/documents?type=${type}`} className="text-xs text-muted hover:text-accent">
            ← Documenti
          </a>
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            {TITLE[type]} {doc?.["number"] ? String(doc["number"]) : doc ? "(bozza)" : "nuovo"}
          </h1>
          {doc ? (
            <p className="text-sm text-muted">
              {DOC_STATUS.find((s) => s.value === doc["status"])?.label} · regime {regime}
            </p>
          ) : (
            <p className="text-sm text-muted">Regime applicato: {regime}</p>
          )}
        </header>

        {locked ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {ws.registry.get("document").lockedReason?.(doc as Rec)}
          </div>
        ) : null}

        <Card title="Intestazione">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              Anagrafica *
              <select
                className={`${CONTROL} mt-1`}
                value={partyId}
                disabled={locked}
                onChange={(e) => setPartyId(e.target.value)}
              >
                <option value="">—</option>
                {data.parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {String(p["name"])}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Data *
              <input
                type="date"
                className={`${CONTROL} mt-1`}
                value={date}
                disabled={locked}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {type === "purchase_invoice" ? (
              <label className="text-xs text-muted">
                Numero fattura del fornitore *
                <input
                  className={`${CONTROL} mt-1`}
                  value={number}
                  disabled={locked}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </label>
            ) : null}
            <label className="text-xs text-muted">
              Scadenza {fiscal ? "pagamento" : "validità"}
              <input
                type="date"
                className={`${CONTROL} mt-1`}
                value={dueDate}
                disabled={locked}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </div>
          {fiscal && !doc?.["number"] && type !== "purchase_invoice" ? (
            <p className="mt-2 text-xs text-muted">
              Il numero progressivo viene assegnato all'emissione.
            </p>
          ) : null}
        </Card>

        <Card title="Righe">
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Prodotto", "Descrizione", "Q.tà", "Prezzo", "Sconto %", "IVA %", "Natura"].map(
                    (h) => (
                      <th key={h} scope="col" className={TH}>
                        {h}
                      </th>
                    ),
                  )}
                  <th scope="col" className={`${TH} text-right`}>
                    Imponibile
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const net = parsed.problem
                    ? 0
                    : (computeTotals([parsed.inputs[index] as DocumentLineInput], "ordinario")
                        .net ?? 0);
                  const exempt = regime === "forfettario" || num(line.vat_rate) === 0;
                  return (
                    <tr key={line.key}>
                      <td className={TD}>
                        <select
                          aria-label={`Prodotto riga ${index + 1}`}
                          className={CONTROL}
                          value={line.product_id}
                          disabled={locked}
                          onChange={(e) => pickProduct(line.key, e.target.value)}
                        >
                          <option value="">—</option>
                          {data.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {String(p["sku"])} · {String(p["name"])}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={TD}>
                        <input
                          aria-label={`Descrizione riga ${index + 1}`}
                          className={`${CONTROL} min-w-48`}
                          value={line.description}
                          disabled={locked}
                          onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        />
                      </td>
                      <td className={TD}>
                        <input
                          aria-label={`Quantità riga ${index + 1}`}
                          inputMode="decimal"
                          className={`${CONTROL} w-20`}
                          value={line.quantity}
                          disabled={locked}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        />
                      </td>
                      <td className={TD}>
                        <input
                          aria-label={`Prezzo riga ${index + 1}`}
                          inputMode="decimal"
                          className={`${CONTROL} w-28 text-right`}
                          value={line.unit_price}
                          disabled={locked}
                          onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                        />
                      </td>
                      <td className={TD}>
                        <input
                          aria-label={`Sconto riga ${index + 1}`}
                          inputMode="decimal"
                          className={`${CONTROL} w-16`}
                          value={line.discount}
                          disabled={locked}
                          onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                        />
                      </td>
                      <td className={TD}>
                        <input
                          aria-label={`IVA riga ${index + 1}`}
                          inputMode="decimal"
                          className={`${CONTROL} w-16`}
                          value={regime === "forfettario" ? "0" : line.vat_rate}
                          disabled={locked || regime === "forfettario"}
                          onChange={(e) => updateLine(line.key, { vat_rate: e.target.value })}
                        />
                      </td>
                      <td className={TD}>
                        {regime === "forfettario" ? (
                          <span className="text-xs text-muted">N2.2</span>
                        ) : (
                          <select
                            aria-label={`Natura riga ${index + 1}`}
                            className={CONTROL}
                            value={line.vat_nature}
                            disabled={locked || !exempt}
                            onChange={(e) => updateLine(line.key, { vat_nature: e.target.value })}
                          >
                            <option value="">—</option>
                            {VAT_NATURES.map((n) => (
                              <option key={n.value} value={n.value}>
                                {n.value}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{formatMoney(net)}</td>
                      <td className={TD}>
                        {!locked && lines.length > 1 ? (
                          <Button
                            aria-label={`Elimina riga ${index + 1}`}
                            onClick={() => setLines((s) => s.filter((l) => l.key !== line.key))}
                          >
                            ✕
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!locked ? (
            <Button
              className="mt-3"
              onClick={() => setLines((s) => [...s, blankLine(company.default_vat_rate)])}
            >
              Aggiungi riga
            </Button>
          ) : null}
        </Card>

        <Card title="Totali">
          {totals ? (
            <dl className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Imponibile</dt>
              <dd className="text-right tabular-nums">{formatMoney(totals.net)}</dd>
              {totals.breakdown
                .filter((b) => b.rate > 0)
                .map((b) => (
                  <div key={b.rate} className="contents">
                    <dt className="text-muted">
                      IVA {b.rate}% su {formatMoney(b.base)}
                    </dt>
                    <dd className="text-right tabular-nums">{formatMoney(b.vat)}</dd>
                  </div>
                ))}
              {totals.stamp ? (
                <>
                  <dt className="text-muted">Imposta di bollo</dt>
                  <dd className="text-right tabular-nums">{formatMoney(totals.stamp)}</dd>
                </>
              ) : null}
              <dt className="font-semibold text-fg">Totale</dt>
              <dd className="text-right text-lg font-semibold tabular-nums text-fg">
                {formatMoney(totals.total)}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">{parsed.problem}</p>
          )}
        </Card>

        <Card title="Note">
          <textarea
            aria-label="Note del documento"
            rows={3}
            className={CONTROL}
            value={notes}
            disabled={locked}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Card>

        <ErrorNote message={message} />
        <div className="flex flex-wrap gap-2">
          {!locked ? (
            <Button
              variant={fiscal ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => void onSave()}
            >
              {doc ? "Salva" : "Salva bozza"}
            </Button>
          ) : null}
          {doc ? (
            <Button disabled={busy} onClick={() => void downloadPdf()}>
              Scarica PDF
            </Button>
          ) : null}
          {fiscal && !locked ? (
            <Button variant="primary" disabled={busy} onClick={() => setConfirmIssue(true)}>
              Emetti
            </Button>
          ) : null}
          {doc && !fiscal && !locked
            ? ALLOWED_STATUS[docType]
                .filter((s) => s !== doc["status"] && s !== "invoiced")
                .map((s) => (
                  <Button key={s} disabled={busy} onClick={() => void setStatus(s)}>
                    Segna come «{DOC_STATUS.find((o) => o.value === s)?.label}»
                  </Button>
                ))
            : null}
          {doc && type === "quote" && doc["status"] === "accepted" ? (
            <Button disabled={busy} onClick={() => void convert("order")}>
              Converti in ordine
            </Button>
          ) : null}
          {doc && (type === "quote" || type === "order") && !locked ? (
            <Button disabled={busy} onClick={() => void convert("invoice")}>
              Converti in fattura
            </Button>
          ) : null}
          {doc && type === "invoice" && doc["status"] === "issued" ? (
            <Button disabled={busy} onClick={() => void creditNote()}>
              Crea nota di credito
            </Button>
          ) : null}
          {doc && !locked && !fiscal ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ws.remove("document", doc.id);
                  go(`documents?type=${type}`);
                })
              }
            >
              Elimina
            </Button>
          ) : null}
          {doc && !locked && fiscal ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ws.remove("document", doc.id);
                  go(`documents?type=${type}`);
                })
              }
            >
              Elimina bozza
            </Button>
          ) : null}
        </div>
      </div>

      <aside className="space-y-4">
        {doc && fiscal && doc["status"] === "issued" ? (
          <PaymentsCard doc={doc} payments={data.payments} open={data.open} onError={setMessage} />
        ) : null}
        {doc ? <AttachmentsPanel entity="document" id={doc.id} /> : null}
        {doc ? <HistoryPanel entity="document" id={doc.id} /> : null}
      </aside>

      {confirmIssue ? (
        <ConfirmDialog
          title={`Emettere ${(TITLE[type] ?? "il documento").toLowerCase()}?`}
          message={
            type === "purchase_invoice"
              ? "Il documento verrà registrato e non sarà più modificabile."
              : "Verrà assegnato il numero progressivo e il documento non sarà più modificabile: per correggerlo si emette una nota di credito."
          }
          confirmLabel="Emetti"
          onConfirm={() => void onIssue()}
          onCancel={() => setConfirmIssue(false)}
        />
      ) : null}
    </div>
  );
}

function PaymentsCard({
  doc,
  payments,
  open,
  onError,
}: {
  doc: Rec;
  payments: Rec[];
  open: number;
  onError: (m: string | null) => void;
}) {
  const ws = useWorkspace();
  const [amount, setAmount] = useState(centsToPlain(open).replace(".", ","));
  const [date, setDate] = useState(ws.ctx.today());
  const [method, setMethod] = useState("bank");
  const add = async () => {
    onError(null);
    const cents = parseMoney(amount);
    if (cents === null) return onError("Importo non valido");
    try {
      await ws.create("payment", { document_id: doc.id, date, amount: cents, method });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const incoming = doc["type"] === "invoice";
  return (
    <Card title={incoming ? "Incassi" : doc["type"] === "credit_note" ? "Rimborsi" : "Pagamenti"}>
      <p className="mb-3 text-sm text-muted">
        Totale {formatMoney(Number(doc["total"]))} · residuo{" "}
        <span className={open > 0 ? "text-fg" : "text-success"}>{formatMoney(open)}</span>
      </p>
      <ul className="mb-3 space-y-1 text-sm">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span>
              {formatDay(String(p["date"]))} · {formatMoney(Number(p["amount"]))} ·{" "}
              {PAYMENT_METHODS.find((m) => m.value === p["method"])?.label}
            </span>
            <Button
              aria-label="Elimina pagamento"
              onClick={() =>
                void ws
                  .remove("payment", p.id)
                  .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
              }
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      {open > 0 ? (
        <div className="grid gap-2">
          <input
            aria-label="Data pagamento"
            type="date"
            className={CONTROL}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            aria-label="Importo pagamento"
            inputMode="decimal"
            className={CONTROL}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select
            aria-label="Metodo di pagamento"
            className={CONTROL}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => void add()}>
            Registra
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
