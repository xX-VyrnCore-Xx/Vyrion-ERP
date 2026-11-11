import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { AppError, ValidationError } from "../data/errors";
import { formatMoney, parseMoney } from "../lib/money";
import { postEntry } from "../modules/accounting";
import { ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay } from "../ui/format";

interface Row {
  key: number;
  account: string;
  debit: string;
  credit: string;
}
let counter = 0;
const blank = (): Row => ({ key: ++counter, account: "", debit: "", credit: "" });

export function JournalPage() {
  const ws = useWorkspace();
  const [year, setYear] = useState(ws.ctx.today().slice(0, 4));
  const [date, setDate] = useState(ws.ctx.today());
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const [message, setMessage] = useState<string | null>(null);

  const data = useAsync(async () => {
    const accounts = (await ws.list("account", { limit: 1000, orderBy: "code asc" })).rows;
    const entries = await ws.db.query<{
      id: string;
      number: string;
      date: string;
      description: string;
      source: string;
      source_id: string | null;
      total: number;
      reversed: number;
    }>(
      `SELECT e.id, e.number, e.date, e.description, e.source, e.source_id, e.total,
              EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = e.id) AS reversed
       FROM journal_entries e WHERE e.date >= ? AND e.date <= ? ORDER BY e.date DESC, e.number DESC LIMIT 300`,
      [`${year}-01-01`, `${year}-12-31`],
    );
    const lines = await ws.db.query<{
      entry_id: string;
      code: string;
      name: string;
      debit: number;
      credit: number;
    }>(
      `SELECT l.entry_id, a.code, a.name, l.debit, l.credit FROM journal_lines l
       JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.date >= ? AND e.date <= ? ORDER BY l.rowid`,
      [`${year}-01-01`, `${year}-12-31`],
    );
    return { accounts, entries, lines };
  }, [year]);

  const parsed = rows.map((r) => ({
    account: r.account,
    debit: r.debit.trim() ? parseMoney(r.debit) : 0,
    credit: r.credit.trim() ? parseMoney(r.credit) : 0,
  }));
  const invalid = parsed.some((r) => r.debit === null || r.credit === null);
  const totalDebit = parsed.reduce((s, r) => s + (r.debit ?? 0), 0);
  const totalCredit = parsed.reduce((s, r) => s + (r.credit ?? 0), 0);
  const balanced = !invalid && totalDebit === totalCredit && totalDebit > 0;

  const fail = (error: unknown) =>
    setMessage(
      error instanceof ValidationError
        ? Object.values(error.errors).join(" · ")
        : error instanceof AppError || error instanceof Error
          ? error.message
          : String(error),
    );

  const post = async () => {
    setMessage(null);
    try {
      await ws.transact((tx, ctx, repo) =>
        postEntry(tx, ctx, repo, {
          date,
          description: description.trim() || "Registrazione manuale",
          source: "manual",
          lines: parsed
            .filter((r) => r.account)
            .map((r) => ({ account: r.account, debit: r.debit ?? 0, credit: r.credit ?? 0 })),
        }),
      );
      setDescription("");
      setRows([blank(), blank()]);
    } catch (error) {
      fail(error);
    }
  };

  const reverse = async (entryId: string, number: string) => {
    setMessage(null);
    try {
      await ws.transact(async (tx, ctx, repo) => {
        const [entry] = await tx.query<{ id: string }>(
          "SELECT id FROM journal_entries WHERE id = ?",
          [entryId],
        );
        if (!entry) return;
        const lines = await tx.query<{ account_id: string; debit: number; credit: number }>(
          "SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ?",
          [entryId],
        );
        await postEntry(tx, ctx, repo, {
          date: ctx.today(),
          description: `Storno ${number}`,
          source: "reversal",
          reversesId: entryId,
          lines: lines.map((l) => ({ account: l.account_id, debit: l.credit, credit: l.debit })),
        });
      });
    } catch (error) {
      fail(error);
    }
  };

  const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
  return (
    <>
      <PageHeader
        title="Prima nota"
        subtitle="Registrazioni in partita doppia. Una volta registrate non si modificano: si correggono con uno storno."
      />
      <div className="space-y-4">
        <Card title="Nuova registrazione">
          <div className="mb-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
            <input
              aria-label="Data registrazione"
              type="date"
              className={input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <input
              aria-label="Descrizione"
              placeholder="Descrizione"
              className={input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Conto
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Dare
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Avere
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.key}>
                  <td className={TD}>
                    <select
                      aria-label={`Conto riga ${i + 1}`}
                      className={`${input} w-full`}
                      value={row.account}
                      onChange={(e) =>
                        setRows((s) =>
                          s.map((r) => (r.key === row.key ? { ...r, account: e.target.value } : r)),
                        )
                      }
                    >
                      <option value="">—</option>
                      {data.data?.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {String(a["code"])} · {String(a["name"])}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(["debit", "credit"] as const).map((side) => (
                    <td key={side} className={TD}>
                      <input
                        aria-label={`${side === "debit" ? "Dare" : "Avere"} riga ${i + 1}`}
                        inputMode="decimal"
                        className={`${input} w-32 text-right`}
                        value={row[side]}
                        onChange={(e) =>
                          setRows((s) =>
                            s.map((r) =>
                              r.key === row.key ? { ...r, [side]: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td className={TD}>
                    {rows.length > 2 ? (
                      <Button
                        aria-label={`Elimina riga ${i + 1}`}
                        onClick={() => setRows((s) => s.filter((r) => r.key !== row.key))}
                      >
                        ✕
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => setRows((s) => [...s, blank()])}>Aggiungi riga</Button>
            <span role="status" className={`text-sm ${balanced ? "text-success" : "text-muted"}`}>
              Dare {formatMoney(totalDebit)} · Avere {formatMoney(totalCredit)}{" "}
              {balanced
                ? "· quadra"
                : totalDebit !== totalCredit
                  ? `· differenza ${formatMoney(Math.abs(totalDebit - totalCredit))}`
                  : ""}
            </span>
            <Button
              variant="primary"
              className="ml-auto"
              disabled={!balanced}
              onClick={() => void post()}
            >
              Registra
            </Button>
          </div>
          <div className="mt-3">
            <ErrorNote message={message} />
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <label className="text-sm text-muted">
            Anno{" "}
            <input
              aria-label="Anno"
              type="number"
              className={`${input} w-24`}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
          <a className="ml-auto text-sm text-accent hover:underline" href={href("e", "account")}>
            Piano dei conti
          </a>
        </div>
        <Card title={`Registrazioni ${year}`}>
          {data.data?.entries.length === 0 ? (
            <p className="text-sm text-muted">Nessuna registrazione in questo anno.</p>
          ) : null}
          <ul className="space-y-4">
            {data.data?.entries.map((e) => (
              <li key={e.id} className="rounded-lg border border-line/60 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium text-fg">{e.number}</span> · {formatDay(e.date)} ·{" "}
                    {e.description}
                    {e.reversed ? (
                      <span className="ml-2 text-xs text-warning">stornata</span>
                    ) : null}
                  </span>
                  {e.source !== "reversal" && !e.reversed ? (
                    <Button onClick={() => void reverse(e.id, e.number)}>Storna</Button>
                  ) : null}
                </div>
                <table className={`${TABLE} mt-2`}>
                  <tbody>
                    {data.data?.lines
                      .filter((l) => l.entry_id === e.id)
                      .map((l, i) => (
                        <tr key={i}>
                          <td className="py-0.5 text-muted">
                            {l.code} · {l.name}
                          </td>
                          <td className="w-32 py-0.5 text-right tabular-nums">
                            {l.debit ? formatMoney(l.debit) : ""}
                          </td>
                          <td className="w-32 py-0.5 text-right tabular-nums">
                            {l.credit ? formatMoney(l.credit) : ""}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
