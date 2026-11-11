import { useState } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { inDesktop, native, pickFile, pickSavePath } from "../lib/native";
import { ConfirmDialog, ErrorNote } from "../ui/parts";

const MIN_PASSPHRASE = 12;

/** Where the data lives, integrity check, encrypted backups and restore. */
export function DataCard() {
  const ws = useWorkspace();
  const desktop = inDesktop();
  const status = useAsync(async () => (desktop ? native.dbStatus() : null), []);
  const [passphrase, setPassphrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [restoreFrom, setRestoreFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<void>) => {
    setMessage(null);
    setNote(null);
    setBusy(true);
    try {
      await job();
    } catch (error) {
      setMessage(
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const needPassphrase = () => {
    if (passphrase.length < MIN_PASSPHRASE) {
      setMessage(`La password del backup deve avere almeno ${MIN_PASSPHRASE} caratteri.`);
      return false;
    }
    return true;
  };

  const backup = () =>
    run(async () => {
      if (!needPassphrase()) return;
      const dest = await pickSavePath("Salva il backup", `vyrion-backup-${ws.ctx.today()}.vyb`);
      if (!dest) return;
      const info = await native.backup(dest, passphrase);
      setNote(`Backup creato e verificato: ${info.path}`);
    });

  const pickRestore = () =>
    run(async () => {
      if (!needPassphrase()) return;
      const source = await pickFile("Scegli il backup da ripristinare");
      if (source) setRestoreFrom(source);
    });

  const restore = () =>
    run(async () => {
      const source = restoreFrom;
      setRestoreFrom(null);
      if (!source) return;
      const outcome = await native.restore(source, passphrase);
      setNote(
        `Ripristino completato.${outcome.previous_copy ? ` I dati precedenti sono stati conservati in ${outcome.previous_copy}.` : ""} L'applicazione si ricarica…`,
      );
      setTimeout(() => window.location.reload(), 1500);
    });

  const check = () =>
    run(async () => {
      const report = await native.integrityCheck();
      setNote(
        report.ok
          ? "Controllo di integrità superato: nessun problema trovato."
          : `Problemi trovati: ${JSON.stringify(report)}`,
      );
    });

  return (
    <Card title="Dati e backup">
      {!desktop ? (
        <p className="text-sm text-muted">
          Modalità sviluppo nel browser: i dati sono in memoria e si perdono alla chiusura. Backup e
          ripristino sono disponibili nell'applicazione desktop.
        </p>
      ) : (
        <div className="space-y-4">
          {status.data ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Archivio</dt>
              <dd className="break-all">{status.data.path}</dd>
              <dt className="text-muted">Cifratura</dt>
              <dd>
                {status.data.cipher_version ? `SQLCipher ${status.data.cipher_version}` : "—"} ·
                chiave nel {status.data.key_store}
              </dd>
              <dt className="text-muted">Dimensione</dt>
              <dd>{(status.data.size_bytes / 1024 / 1024).toFixed(2)} MB</dd>
            </dl>
          ) : null}
          <div>
            <label
              htmlFor="backup-passphrase"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Password del backup (almeno {MIN_PASSPHRASE} caratteri)
            </label>
            <input
              id="backup-passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full max-w-sm rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg"
            />
            <p className="mt-1 text-xs text-muted">
              Il backup è cifrato con questa password. Senza la password non si può ripristinare:
              conservala a parte.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void backup()}>
              Crea backup…
            </Button>
            <Button disabled={busy} onClick={() => void pickRestore()}>
              Ripristina da backup…
            </Button>
            <Button disabled={busy} onClick={() => void check()}>
              Controlla integrità
            </Button>
          </div>
          <ErrorNote message={message} />
          {note ? (
            <p role="status" className="text-sm text-success">
              {note}
            </p>
          ) : null}
        </div>
      )}
      {restoreFrom ? (
        <ConfirmDialog
          title="Ripristinare questo backup?"
          message="I dati attuali verranno sostituiti da quelli del backup. La copia attuale viene comunque conservata sul disco. Continua solo se sei sicuro."
          confirmLabel="Ripristina"
          onConfirm={() => void restore()}
          onCancel={() => setRestoreFrom(null)}
        />
      ) : null}
    </Card>
  );
}
