import { PageHeader, Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { formatMoney } from "../lib/money";
import { aging, type AgingRow } from "../modules/reports";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { formatDay } from "../ui/format";

const BUCKETS: { key: AgingRow["bucket"]; label: string }[] = [
  { key: "not_due", label: "Non scaduto" },
  { key: "1-30", label: "1–30 giorni" },
  { key: "31-60", label: "31–60 giorni" },
  { key: "61-90", label: "61–90 giorni" },
  { key: "90+", label: "Oltre 90 giorni" },
];

function Schedule({
  title,
  rows,
  type,
}: {
  title: string;
  rows: AgingRow[];
  type: (row: AgingRow) => string;
}) {
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  return (
    <Card title={`${title} · ${formatMoney(total)}`}>
      {rows.length === 0 ? (
        <Empty>Nessuna scadenza aperta.</Empty>
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {BUCKETS.map((b) => (
              <div key={b.key} className="rounded-lg bg-raised px-3 py-2">
                <dt className="text-xs text-muted">{b.label}</dt>
                <dd className="tabular-nums text-fg">
                  {formatMoney(
                    rows.filter((r) => r.bucket === b.key).reduce((s, r) => s + r.outstanding, 0),
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Documento", "Anagrafica", "Scadenza", "Stato"].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} text-right`}>
                    Residuo
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.documentId} className="hover:bg-raised">
                    <td className={TD}>
                      <a
                        className="font-medium text-fg hover:text-accent"
                        href={href("d", type(r), r.documentId)}
                      >
                        {r.number}
                      </a>
                    </td>
                    <td className={TD}>{r.party}</td>
                    <td className={TD}>{formatDay(r.dueDate)}</td>
                    <td className={TD}>
                      {r.daysOverdue > 0 ? (
                        <Badge tone="danger">Scaduto da {r.daysOverdue} gg</Badge>
                      ) : (
                        <Badge>Tra {-r.daysOverdue} gg</Badge>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {formatMoney(r.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export function DeadlinesPage() {
  const ws = useWorkspace();
  const data = useAsync(async () => {
    const today = ws.ctx.today();
    return {
      receivable: await aging(ws.db, today, "receivable"),
      payable: await aging(ws.db, today, "payable"),
    };
  }, []);
  return (
    <>
      <PageHeader
        title="Scadenzario"
        subtitle="Cosa devono pagarti i clienti e cosa devi pagare ai fornitori, per fascia di scaduto."
      />
      <ErrorNote message={data.error} />
      <div className="space-y-4">
        <Schedule
          title="Da incassare"
          rows={data.data?.receivable ?? []}
          type={(r) => (r.total < 0 ? "credit_note" : "invoice")}
        />
        <Schedule
          title="Da pagare"
          rows={data.data?.payable ?? []}
          type={() => "purchase_invoice"}
        />
      </div>
    </>
  );
}
