import { useState } from "react";

import { useSync } from "../app/sync";
import { Card } from "../components/Card";
import { Badge, ErrorNote } from "../ui/parts";
import type { Role } from "./types";
import { useRemote } from "./useRemote";

/** Roles of the server and the permissions each one grants. */
export function RolesPane() {
  const sync = useSync();
  const roles = useRemote(() => sync.request<Role[]>("GET", "/roles"), []);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Ruoli e permessi">
      <ErrorNote message={roles.error} />
      <ul className="divide-y divide-line/60">
        {(roles.data ?? []).map((r) => {
          const expanded = open === r.id;
          const byModule = new Map<string, string[]>();
          for (const p of r.permissions)
            byModule.set(p.module, [
              ...(byModule.get(p.module) ?? []),
              `${p.resource}:${p.action}`,
            ]);
          return (
            <li key={r.id} className="py-3">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : r.id)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span>
                  <span className="text-sm font-medium text-fg">{r.name}</span>
                  <span className="block text-xs text-muted">{r.description}</span>
                </span>
                <span className="flex items-center gap-2">
                  {r.is_system ? <Badge tone="info">Di sistema</Badge> : null}
                  <Badge>{r.permissions.length} permessi</Badge>
                </span>
              </button>
              {expanded ? (
                <div className="mt-3 space-y-2 text-xs">
                  {[...byModule].map(([module, items]) => (
                    <div key={module}>
                      <span className="font-semibold uppercase tracking-wider text-muted">
                        {module}
                      </span>
                      <p className="mt-0.5 text-fg">{items.join(" · ")}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
