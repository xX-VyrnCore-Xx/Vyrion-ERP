import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { accountantPackage } from "../modules/accountantExport";
import { Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import { saveBytes } from "../ui/saveBytes";
import { saveText } from "../ui/saveText";

const input = "rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg";

/** One package with the books and registers of a year, for the accountant. */
export function AccountantExportPage() {
  const ws = useWorkspace();
  const today = ws.ctx.today();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const data = useAsync(() => accountantPackage(ws.db, year, today), [year]);

  const attempt = async (job: () => Promise<string>) => {
    setMessage(null);
    try {
      setMessage({ ok: true, text: await job() });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const pkg = data.data;
  return (
    <>
      <PageHeader
        title="Esportazione per il commercialista"
        subtitle="Prima nota, bilancio di verifica, registri IVA, liquidazioni, ritenute, scadenziario e prospetti paga di un anno, in un unico archivio ZIP."
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
        <Button
          variant="primary"
          disabled={!pkg}
          onClick={() =>
            void attempt(async () => {
              if (!pkg) return "";
              const saved = await saveBytes(pkg.fileName, pkg.bytes);
              return saved ? `Pacchetto ${pkg.fileName} salvato.` : "Salvataggio annullato.";
            })
          }
        >
          Scarica il pacchetto (.zip)
        </Button>
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
      <Card title={`Contenuto del pacchetto ${year}`}>
        {!pkg ? (
          <Empty>Preparazione…</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  {["File", "Contenuto"].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} text-right`}>
                    Righe
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pkg.files.map((f) => (
                  <tr key={f.name}>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>{f.name}</td>
                    <td className={TD}>{f.description}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {f.name === "LEGGIMI.txt" ? "" : f.rows}
                    </td>
                    <td className={`${TD} text-right`}>
                      <Button
                        aria-label={`Scarica ${f.name}`}
                        onClick={() =>
                          void attempt(async () => {
                            const saved = await saveText(
                              f.name,
                              f.content,
                              f.name.endsWith(".txt")
                                ? "text/plain;charset=utf-8"
                                : "text/csv;charset=utf-8",
                            );
                            return saved ? `${f.name} salvato.` : "Salvataggio annullato.";
                          })
                        }
                      >
                        Scarica
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          I file riportano i dati registrati nel programma (importi in euro, CSV con punto e virgola
          che Excel apre direttamente). Non sono dichiarazioni né comunicazioni fiscali: i calcoli
          vanno verificati dal commercialista.
        </p>
      </Card>
    </>
  );
}
