import { useState, type FormEvent } from "react";

import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { formatInstant } from "../ui/format";
import { Badge, ConfirmDialog, Dialog, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import type { Invitation, Page, Role, ServerUser, SetupToken } from "./types";
import { useRemote } from "./useRemote";

const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg";

type Action =
  | { kind: "invite" }
  | { kind: "roles"; user: ServerUser }
  | { kind: "toggle"; user: ServerUser }
  | { kind: "revoke"; user: ServerUser }
  | { kind: "reset"; user: ServerUser }
  | { kind: "twofa"; user: ServerUser };

/** Accounts of the company server: invite, activate/deactivate, roles, resets, sessions. */
export function UsersPane() {
  const sync = useSync();
  const users = useRemote(() => sync.request<Page<ServerUser>>("GET", "/users?limit=200"), []);
  const roles = useRemote(() => sync.request<Role[]>("GET", "/roles"), []);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; token: SetupToken } | null>(null);

  const run = async (job: () => Promise<void>) => {
    setError(null);
    try {
      await job();
      setAction(null);
      users.reload();
    } catch (e) {
      setAction(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card title="Utenti del server">
      <div className="mb-4 flex justify-end">
        <Button variant="primary" onClick={() => setAction({ kind: "invite" })}>
          Invita utente
        </Button>
      </div>
      <ErrorNote message={error ?? users.error} />
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Utente</th>
              <th className={TH}>Ruoli</th>
              <th className={TH}>Stato</th>
              <th className={TH}>Ultimo accesso</th>
              <th className={TH}>
                <span className="sr-only">Azioni</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.items ?? []).map((u) => (
              <tr key={u.id}>
                <td className={TD}>
                  <div className="text-fg">{u.full_name}</div>
                  <div className="text-xs text-muted">{u.email}</div>
                </td>
                <td className={TD}>{u.roles.map((r) => r.name).join(", ") || "—"}</td>
                <td className={TD}>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={u.is_active ? "success" : "neutral"}>
                      {u.is_active ? "Attivo" : "Disattivato"}
                    </Badge>
                    {!u.has_password ? <Badge tone="warning">Invito in attesa</Badge> : null}
                    {u.totp_enabled ? <Badge tone="info">2FA</Badge> : null}
                    {u.locked_until ? <Badge tone="danger">Bloccato</Badge> : null}
                  </div>
                </td>
                <td className={TD}>{u.last_login_at ? formatInstant(u.last_login_at) : "mai"}</td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button onClick={() => setAction({ kind: "roles", user: u })}>Ruoli</Button>
                    <Button onClick={() => setAction({ kind: "toggle", user: u })}>
                      {u.is_active ? "Disattiva" : "Riattiva"}
                    </Button>
                    <Button onClick={() => setAction({ kind: "revoke", user: u })}>
                      Disconnetti
                    </Button>
                    <Button onClick={() => setAction({ kind: "reset", user: u })}>Password</Button>
                    {u.totp_enabled ? (
                      <Button onClick={() => setAction({ kind: "twofa", user: u })}>
                        Reset 2FA
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.data && users.data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nessun utente.</p>
      ) : null}

      {action?.kind === "invite" ? (
        <InviteDialog
          onClose={() => setAction(null)}
          onDone={(invite) => {
            setAction(null);
            users.reload();
            setSecret({ title: `Invito per ${invite.user.email}`, token: invite });
          }}
        />
      ) : null}
      {action?.kind === "roles" ? (
        <RolesDialog
          user={action.user}
          roles={roles.data ?? []}
          onClose={() => setAction(null)}
          onSave={(keys) =>
            run(async () => {
              await sync.request("PUT", `/users/${action.user.id}/roles`, {
                version: action.user.version,
                roles: keys,
              });
            })
          }
        />
      ) : null}
      {action?.kind === "toggle" ? (
        <ConfirmDialog
          title={action.user.is_active ? "Disattivare l'utente?" : "Riattivare l'utente?"}
          message={
            action.user.is_active
              ? `${action.user.full_name} non potrà più accedere al server e verrà disconnesso.`
              : `${action.user.full_name} potrà accedere di nuovo al server.`
          }
          confirmLabel={action.user.is_active ? "Disattiva" : "Riattiva"}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(async () => {
              await sync.request("PATCH", `/users/${action.user.id}`, {
                version: action.user.version,
                is_active: !action.user.is_active,
              });
            })
          }
        />
      ) : null}
      {action?.kind === "revoke" ? (
        <ConfirmDialog
          title="Disconnettere l'utente?"
          message={`${action.user.full_name} verrà scollegato da tutti i dispositivi e dovrà accedere di nuovo.`}
          confirmLabel="Disconnetti"
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(async () => {
              await sync.request("POST", `/users/${action.user.id}/revoke-sessions`);
            })
          }
        />
      ) : null}
      {action?.kind === "twofa" ? (
        <ConfirmDialog
          title="Azzerare la verifica in due passaggi?"
          message={`${action.user.full_name} dovrà configurarla di nuovo al prossimo accesso.`}
          confirmLabel="Azzera"
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(async () => {
              await sync.request("POST", `/users/${action.user.id}/2fa/reset`);
            })
          }
        />
      ) : null}
      {action?.kind === "reset" ? (
        <ConfirmDialog
          title="Reimpostare la password?"
          message={`Genero un codice monouso per ${action.user.full_name}: la password attuale smette di valere.`}
          confirmLabel="Genera codice"
          onCancel={() => setAction(null)}
          onConfirm={() => {
            const target = action.user;
            void run(async () => {
              const token = await sync.request<SetupToken>(
                "POST",
                `/users/${target.id}/password-reset`,
              );
              setSecret({ title: `Codice per ${target.email}`, token });
            });
          }}
        />
      ) : null}
      {secret ? (
        <Dialog title={secret.title} onClose={() => setSecret(null)}>
          <p className="mb-2 text-sm text-muted">
            Consegnalo all'utente con un canale sicuro: si vede una sola volta.
          </p>
          <code className="mb-2 block break-all rounded-lg bg-raised p-3 text-sm text-fg">
            {secret.token.setup_token}
          </code>
          <p className="mb-4 text-xs text-muted">
            Valido fino al {formatInstant(secret.token.expires_at)}.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setSecret(null)}>
              Fatto
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function InviteDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (invite: Invitation) => void;
}) {
  const sync = useSync();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(
        await sync.request<Invitation>("POST", "/users", {
          email: email.trim(),
          full_name: name.trim(),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Invita un utente" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <label className="block text-xs font-medium text-muted">
          Nome e cognome
          <input
            className={`${INPUT} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-muted">
          Email
          <input
            className={`${INPUT} mt-1`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Annulla</Button>
          <Button type="submit" variant="primary" disabled={busy || !email || !name}>
            Crea invito
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RolesDialog({
  user,
  roles,
  onClose,
  onSave,
}: {
  user: ServerUser;
  roles: Role[];
  onClose: () => void;
  onSave: (keys: string[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState(new Set(user.roles.map((r) => r.key)));
  const toggle = (key: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <Dialog title={`Ruoli di ${user.full_name}`} onClose={onClose}>
      <ul className="mb-4 max-h-72 space-y-2 overflow-y-auto">
        {roles.map((r) => (
          <li key={r.id}>
            <label className="flex items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--accent)]"
                checked={chosen.has(r.key)}
                onChange={() => toggle(r.key)}
              />
              <span>
                {r.name}
                <span className="block text-xs text-muted">{r.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="primary" onClick={() => void onSave([...chosen])}>
          Salva
        </Button>
      </div>
    </Dialog>
  );
}
