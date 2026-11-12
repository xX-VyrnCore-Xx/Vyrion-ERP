import {
  Building2,
  DatabaseBackup,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Users,
  Activity,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "../components/Card";
import type { ServerStatus } from "../hooks/useServerStatus";
import { href } from "../app/router";
import { AuditPane } from "./AuditPane";
import { BackupsPane } from "./BackupsPane";
import { CompanyPane } from "./CompanyPane";
import { Gate } from "./Gate";
import { RolesPane } from "./RolesPane";
import { SessionsPane } from "./SessionsPane";
import { StatusPane } from "./StatusPane";
import { UsersPane } from "./UsersPane";

export interface ConsoleTab {
  key: string;
  label: string;
  icon: LucideIcon;
}
export const CONSOLE_TABS: ConsoleTab[] = [
  { key: "stato", label: "Stato e sincronizzazione", icon: Activity },
  { key: "utenti", label: "Utenti", icon: Users },
  { key: "ruoli", label: "Ruoli e permessi", icon: ShieldCheck },
  { key: "attivita", label: "Registro attività", icon: ScrollText },
  { key: "sessioni", label: "Sessioni e accessi", icon: KeyRound },
  { key: "backup", label: "Backup", icon: DatabaseBackup },
  { key: "azienda", label: "Azienda", icon: Building2 },
];

const FIRST_TAB: ConsoleTab = { key: "stato", label: "Stato e sincronizzazione", icon: Activity };

interface Props {
  tab: string;
  serverUrl: string | null;
  status: ServerStatus;
  go: (to: string) => void;
}

/** The server as a program of its own inside the app: its own menu, one pane at a time. */
export function ServerConsole({ tab, serverUrl, status, go }: Props) {
  const current = CONSOLE_TABS.find((t) => t.key === tab) ?? FIRST_TAB;
  let pane: ReactNode;
  switch (current.key) {
    case "utenti":
      pane = <UsersPane />;
      break;
    case "ruoli":
      pane = <RolesPane />;
      break;
    case "attivita":
      pane = <AuditPane />;
      break;
    case "sessioni":
      pane = <SessionsPane />;
      break;
    case "backup":
      pane = <BackupsPane />;
      break;
    case "azienda":
      pane = <CompanyPane />;
      break;
    default:
      pane = null;
  }
  return (
    <>
      <PageHeader
        title="Console del server"
        subtitle="Gestisci il server aziendale senza uscire dal software: stato, sincronizzazione, utenti e sicurezza."
      />
      <div className="grid gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav aria-label="Console del server" className="flex gap-1 overflow-x-auto lg:flex-col">
          {CONSOLE_TABS.map((t) => {
            const active = t.key === current.key;
            return (
              <a
                key={t.key}
                href={href("server", t.key)}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-raised font-medium text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
              >
                <t.icon aria-hidden="true" className={`size-4 ${active ? "text-accent" : ""}`} />
                {t.label}
              </a>
            );
          })}
        </nav>
        <div className="min-w-0">
          {current.key === "stato" ? (
            <StatusPane serverUrl={serverUrl} status={status} go={go} />
          ) : (
            <Gate go={go}>{pane}</Gate>
          )}
        </div>
      </div>
    </>
  );
}
