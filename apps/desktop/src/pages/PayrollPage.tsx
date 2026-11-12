import { useState, type ChangeEvent } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatMoney } from "../lib/money";
import { hours, importPunches, monthlyAttendance } from "../modules/attendance";
import { generatePayslip, payPayslip, payrollTotals, registerPayslip } from "../modules/payroll";
import { toCsv } from "../modules/reports";
import { Badge, ConfirmDialog, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { saveText } from "../ui/saveText";

const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";
type Tab = "attendance" | "payslips";
const STATUS = { draft: "Bozza", registered: "Registrato", paid: "Pagato" } as const;

/** Attendance of the month (with time clock import) and the monthly payroll statements. */
export function PayrollPage() {
  const ws = useWorkspace();
  const today = ws.ctx.today();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [tab, setTab] = useState<Tab>("attendance");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const safeMonth = Math.min(Math.max(1, month), 12);
  const period = `${year}-${String(safeMonth).padStart(2, "0")}`;

  const data = useAsync(async () => {
    const [attendance, slips, totals, employees] = await Promise.all([
      monthlyAttendance(ws.db, year, safeMonth),
      ws.list("payslip", { limit: 200, orderBy: "created_at asc" }),
      payrollTotals(ws.db, period),
      ws.list("employee", { limit: 200 }),
    ]);
    return {
      attendance,
      slips: slips.rows.filter((s) => s["period"] === period),
      totals,
      names: new Map(employees.rows.map((e) => [e.id, `${e["first_name"]} ${e["last_name"]}`])),
      employees: employees.rows,
    };
  }, [year, safeMonth, tab]);

  const attempt = async (job: () => Promise<string>) => {
    setMessage(null);
    try {
      setMessage({ ok: true, text: await job() });
      ws.touch();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await attempt(async () => {
      const r = await importPunches(ws, await file.text());
      const first = r.problems[0];
      return `Importate ${r.created} presenze, ${r.updated} aggiornate${r.problems.length ? `; ${r.problems.length} righe saltate (prima: riga ${first?.line}, ${first?.reason})` : ""}.`;
    });
    event.target.value = "";
  };

  const d = data.data;
  const withoutSlip = (d?.employees ?? []).filter(
    (e) => Number(e["gross_monthly"] ?? 0) > 0 && !d?.slips.some((s) => s["employee_id"] === e.id),
  );
  return (
    <>
      <PageHeader
        title="Presenze e buste paga"
        subtitle="Ore del mese, import dal timbratore e prospetti delle retribuzioni. Strumento di lavoro: la busta paga ufficiale la emette il consulente del lavoro."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-fg">
        <label className="flex items-center gap-2">
          Anno
          <input
            type="number"
            aria-label="Anno"
            className={`${input} w-24`}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          Mese
          <input
            type="number"
            aria-label="Mese"
            min={1}
            max={12}
            className={`${input} w-20`}
            value={safeMonth}
            onChange={(e) => setMonth(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Sezioni">
        {(
          [
            ["attendance", "Presenze"],
            ["payslips", "Buste paga"],
          ] as const
        ).map(([key, name]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {name}
          </Button>
        ))}
      </div>
      <ErrorNote message={data.error} />
      {message ? (
        message.ok ? (
          <p role="status" className="mb-4 text-sm text-success">
            {message.text}
          </p>
        ) : (
          <div className="mb-4">
            <ErrorNote message={message.text} />
          </div>
        )
      ) : null}

      {tab === "attendance" ? (
        <div className="space-y-4">
          <Card title="Importa dal timbratore">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="Presenze CSV"
              onChange={(e) => void onFile(e)}
              className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-fg"
            />
            <p className="mt-2 text-xs text-muted">
              Colonne richieste: Dipendente (email o «Cognome Nome»), Data, Entrata, Uscita; Pausa
              (minuti) è facoltativa. Importare di nuovo lo stesso giorno lo aggiorna.
            </p>
          </Card>
          <Card title={`Ore di ${period}`}>
            {!d || d.attendance.length === 0 ? (
              <Empty>Nessun dipendente in forza in questo mese.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Dipendente
                      </th>
                      {[
                        "Attese",
                        "Lavorate",
                        "Straordinario",
                        "Mancanti",
                        "Ferie",
                        "Malattia",
                        "Permessi",
                      ].map((h) => (
                        <th key={h} scope="col" className={`${TH} text-right`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.attendance.map((r) => (
                      <tr key={r.employeeId}>
                        <td className={TD}>{r.name}</td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {hours(r.expectedMinutes)}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {hours(r.workedMinutes)}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {hours(r.overtimeMinutes)}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {hours(r.missingMinutes)}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{r.leaveDays.vacation}</td>
                        <td className={`${TD} text-right tabular-nums`}>{r.leaveDays.sick}</td>
                        <td className={`${TD} text-right tabular-nums`}>{r.leaveDays.permit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Ore attese = giorni lavorativi (lun–ven, esclusi i festivi nazionali e le assenze
              approvate) × ore settimanali ÷ 5. Lo straordinario è ciò che le supera.
            </p>
            <Button
              className="mt-3"
              onClick={() =>
                void attempt(async () => {
                  await saveText(
                    `presenze_${period}.csv`,
                    toCsv(
                      [
                        { key: "name", label: "Dipendente" },
                        { key: "expected", label: "Ore attese" },
                        { key: "worked", label: "Ore lavorate" },
                        { key: "overtime", label: "Straordinario" },
                        { key: "missing", label: "Ore mancanti" },
                        { key: "vacation", label: "Giorni ferie" },
                        { key: "sick", label: "Giorni malattia" },
                        { key: "permit", label: "Giorni permesso" },
                      ],
                      (d?.attendance ?? []).map((r) => ({
                        name: r.name,
                        expected: hours(r.expectedMinutes),
                        worked: hours(r.workedMinutes),
                        overtime: hours(r.overtimeMinutes),
                        missing: hours(r.missingMinutes),
                        vacation: r.leaveDays.vacation,
                        sick: r.leaveDays.sick,
                        permit: r.leaveDays.permit,
                      })),
                    ),
                  );
                  return "Presenze esportate.";
                })
              }
            >
              Esporta CSV
            </Button>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <Card title={`Buste paga di ${period}`}>
            {withoutSlip.length > 0 ? (
              <Button
                className="mb-3"
                variant="primary"
                onClick={() =>
                  void attempt(async () => {
                    for (const e of withoutSlip) await generatePayslip(ws, e.id, period);
                    return `Create ${withoutSlip.length} buste paga in bozza.`;
                  })
                }
              >
                Genera le buste paga mancanti ({withoutSlip.length})
              </Button>
            ) : null}
            {!d || d.slips.length === 0 ? (
              <Empty>
                Nessuna busta paga in questo mese. Imposta il lordo mensile e le aliquote nella
                scheda del dipendente, poi generale da qui.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Dipendente
                      </th>
                      <th scope="col" className={TH}>
                        Stato
                      </th>
                      {["Lordo", "Netto", "Costo azienda"].map((h) => (
                        <th key={h} scope="col" className={`${TH} text-right`}>
                          {h}
                        </th>
                      ))}
                      <th scope="col" className={TH}>
                        <span className="sr-only">Azioni</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.slips.map((s) => {
                      const status = String(s["status"]) as keyof typeof STATUS;
                      const name = d.names.get(String(s["employee_id"])) ?? "—";
                      return (
                        <tr key={s.id}>
                          <td className={TD}>{name}</td>
                          <td className={TD}>
                            <Badge
                              tone={
                                status === "paid"
                                  ? "success"
                                  : status === "draft"
                                    ? "warning"
                                    : "info"
                              }
                            >
                              {STATUS[status]}
                            </Badge>
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {formatMoney(Number(s["gross"]))}
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {formatMoney(Number(s["net"]))}
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {formatMoney(Number(s["total_cost"]))}
                          </td>
                          <td className={`${TD} whitespace-nowrap text-right`}>
                            {status === "draft" ? (
                              <Button
                                aria-label={`Registra la busta paga di ${name}`}
                                onClick={() =>
                                  void attempt(async () => {
                                    await registerPayslip(ws, s.id);
                                    return `Busta paga di ${name} registrata in prima nota.`;
                                  })
                                }
                              >
                                Registra
                              </Button>
                            ) : null}
                            {status === "registered" ? (
                              <Button
                                aria-label={`Segna come pagata la busta paga di ${name}`}
                                onClick={() =>
                                  void attempt(async () => {
                                    await payPayslip(ws, s.id, ws.ctx.today());
                                    return `Pagamento di ${name} registrato.`;
                                  })
                                }
                              >
                                Paga
                              </Button>
                            ) : null}
                            {status !== "paid" ? (
                              <Button
                                variant="secondary"
                                aria-label={`Elimina la busta paga di ${name}`}
                                onClick={() => setUndo(s.id)}
                              >
                                Elimina
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {d && d.slips.length > 0 ? (
              <dl className="mt-4 grid max-w-lg grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted">Lordo</dt>
                <dd className="text-right tabular-nums">{formatMoney(d.totals.gross)}</dd>
                <dt className="text-muted">Contributi a carico dei dipendenti</dt>
                <dd className="text-right tabular-nums">{formatMoney(d.totals.contribEmployee)}</dd>
                <dt className="text-muted">Contributi a carico dell'azienda</dt>
                <dd className="text-right tabular-nums">{formatMoney(d.totals.contribEmployer)}</dd>
                <dt className="text-muted">Ritenute IRPEF da versare</dt>
                <dd className="text-right tabular-nums">{formatMoney(d.totals.incomeTax)}</dd>
                <dt className="font-medium text-fg">Netto ai dipendenti</dt>
                <dd className="text-right font-medium tabular-nums">{formatMoney(d.totals.net)}</dd>
                <dt className="font-semibold text-fg">Costo del lavoro</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {formatMoney(d.totals.totalCost)}
                </dd>
              </dl>
            ) : null}
            <p className="mt-3 text-xs text-muted">
              Il prospetto applica le aliquote indicate nella scheda del dipendente (contributi
              INPS, ritenuta media): non conosce scaglioni, detrazioni, addizionali, TFR né il
              contratto collettivo. Lo straordinario è pagato con una maggiorazione del 25%. Fai
              verificare le cifre al consulente del lavoro prima di usarle per pagare.
            </p>
          </Card>
        </div>
      )}

      {undo ? (
        <ConfirmDialog
          title="Eliminare la busta paga?"
          message="Se è già registrata, la scrittura in prima nota viene stornata. Potrai rifarla."
          confirmLabel="Elimina"
          onCancel={() => setUndo(null)}
          onConfirm={() => {
            const id = undo;
            setUndo(null);
            void attempt(async () => {
              await ws.remove("payslip", id);
              return "Busta paga eliminata.";
            });
          }}
        />
      ) : null}
    </>
  );
}
