import { useState } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { inDesktop, native, pickFile, pickSavePath } from "../lib/native";
import { formatInstant } from "./format";
import { ConfirmDialog, ErrorNote } from "./parts";

const kb = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Files attached to a record: stored by content hash on this computer. */
export function AttachmentsPanel({ entity, id }: { entity: string; id: string }) {
  const ws = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; hash: string; name: string } | null>(null);
  const list = useAsync(
    () => ws.list("attachment", { filters: { owner_entity: entity, owner_id: id }, limit: 200 }),
    [entity, id],
  );

  const run = async (job: () => Promise<void>) => {
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = () =>
    run(async () => {
      const source = await pickFile("Scegli il file da allegare");
      if (!source) return;
      const stored = await native.storeAttachment(source);
      const ext = stored.name.split(".").pop()?.toLowerCase() ?? "";
      try {
        await ws.create("attachment", {
          owner_entity: entity,
          owner_id: id,
          file_name: stored.name,
          mime_type: MIME[ext] ?? null,
          size: stored.size_bytes,
          sha256: stored.hash,
        });
      } catch (e) {
        if (stored.is_new) await native.deleteAttachment(stored.hash);
        throw e;
      }
    });

  const confirmRemove = () =>
    run(async () => {
      if (!removing) return;
      await ws.remove("attachment", removing.id);
      // The file is shared by every record that attached the same content.
      const [still] = await ws.db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM attachments WHERE sha256 = ? AND deleted_at IS NULL",
        [removing.hash],
      );
      if (Number(still?.n) === 0) await native.deleteAttachment(removing.hash);
      setRemoving(null);
    });

  return (
    <Card title="Allegati">
      {inDesktop() ? (
        <div className="space-y-3">
          <ErrorNote message={error} />
          {list.data?.rows.length === 0 ? (
            <p className="text-sm text-muted">Nessun allegato.</p>
          ) : null}
          <ul className="divide-y divide-line/60 text-sm">
            {list.data?.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-fg">{String(row["file_name"])}</div>
                  <div className="text-xs text-muted">
                    {kb(Number(row["size"]))} · {formatInstant(row.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    onClick={() =>
                      run(() =>
                        native.openAttachment(String(row["sha256"]), String(row["file_name"])),
                      )
                    }
                  >
                    Apri
                  </Button>
                  <Button
                    onClick={() =>
                      run(async () => {
                        const dest = await pickSavePath("Salva allegato", String(row["file_name"]));
                        if (dest) await native.exportAttachment(String(row["sha256"]), dest);
                      })
                    }
                  >
                    Salva con nome
                  </Button>
                  <Button
                    onClick={() =>
                      setRemoving({
                        id: row.id,
                        hash: String(row["sha256"]),
                        name: String(row["file_name"]),
                      })
                    }
                  >
                    Elimina
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button onClick={() => void add()}>Aggiungi allegato</Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Gli allegati sono disponibili nell'applicazione desktop.
        </p>
      )}
      {removing ? (
        <ConfirmDialog
          title="Eliminare l'allegato?"
          message={`«${removing.name}» verrà rimosso da questo record.`}
          confirmLabel="Elimina"
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </Card>
  );
}
