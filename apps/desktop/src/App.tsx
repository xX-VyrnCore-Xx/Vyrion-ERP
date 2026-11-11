import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppContext, useAsync, useWorkspace } from "./app/context";
import { boot, type Booted } from "./app/boot";
import { useRoute } from "./app/router";
import type { Workspace } from "./data/workspace";
import { Sidebar } from "./components/Sidebar";
import { useServerStatus } from "./hooks/useServerStatus";
import { useTheme } from "./hooks/useTheme";
import { loadServerUrl, saveServerUrl } from "./lib/serverUrl";
import { CalendarPage } from "./pages/CalendarPage";
import { CompanyCard } from "./pages/CompanyCard";
import { DashboardPage } from "./pages/DashboardPage";
import { DeadlinesPage } from "./pages/DeadlinesPage";
import { DocumentEditor } from "./pages/DocumentEditor";
import { DocumentRedirect } from "./pages/DocumentRedirect";
import { DocumentsPage } from "./pages/DocumentsPage";
import { EntityFormPage } from "./pages/EntityFormPage";
import { EntityListPage } from "./pages/EntityListPage";
import { InventoryPage } from "./pages/InventoryPage";
import { JournalPage } from "./pages/JournalPage";
import { MonitorPage } from "./pages/MonitorPage";
import { PipelinePage } from "./pages/PipelinePage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SystemStatusPage } from "./pages/SystemStatusPage";
import { getCompany } from "./modules/company";
import { TopBar } from "./ui/TopBar";
import { PageHeader } from "./components/Card";

type Boot =
  { state: "loading" } | { state: "error"; message: string } | ({ state: "ready" } & Booted);

/** Opens the local database, then renders the application. `preloaded` is for tests. */
export function App({ preloaded }: { preloaded?: Workspace }) {
  const [booted, setBooted] = useState<Boot>(
    preloaded ? { state: "ready", ws: preloaded, volatile: false } : { state: "loading" },
  );

  useEffect(() => {
    if (preloaded) return;
    let current = true;
    boot().then(
      (result) => current && setBooted({ state: "ready", ...result }),
      (error: unknown) =>
        current &&
        setBooted({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      current = false;
    };
  }, [preloaded]);

  if (booted.state === "loading")
    return <p className="p-8 text-sm text-muted">Apertura dei dati locali…</p>;
  if (booted.state === "error") {
    return (
      <div
        role="alert"
        className="mx-auto mt-16 max-w-xl rounded-xl border border-danger/40 bg-danger/10 p-6 text-sm text-danger"
      >
        <h1 className="mb-2 text-base font-semibold">Impossibile aprire i dati</h1>
        <p>{booted.message}</p>
        <p className="mt-3 text-muted">
          I dati non sono stati modificati. Se il problema persiste, ripristina un backup oppure
          contatta chi gestisce l'installazione.
        </p>
      </div>
    );
  }
  return (
    <AppContext.Provider value={{ ws: booted.ws, volatile: booted.volatile }}>
      <Shell volatile={booted.volatile} />
    </AppContext.Provider>
  );
}

function Shell({ volatile }: { volatile: boolean }) {
  const ws = useWorkspace();
  const [route, go] = useRoute();
  const [serverUrl, setServerUrl] = useState<string | null>(loadServerUrl);
  const [theme, setTheme] = useTheme();
  const status = useServerStatus(serverUrl);
  const company = useAsync(() => getCompany(ws.db), []);

  const changeServerUrl = useCallback((url: string | null) => {
    saveServerUrl(url);
    setServerUrl(url);
  }, []);

  const path = route.path.join("/");
  const [section = "", a = "", b = ""] = route.path;
  let page: ReactNode;
  if (company.data === null && !company.loading && path !== "settings") {
    page = (
      <>
        <PageHeader
          title="Benvenuto in Vyrion ERP"
          subtitle="Per iniziare indica i dati dell'azienda. Si usano nei documenti e nei calcoli fiscali; potrai modificarli quando vuoi."
        />
        <div className="max-w-3xl">
          <CompanyCard />
        </div>
      </>
    );
  } else if (section === "") page = <DashboardPage />;
  else if (section === "e" && a === "document" && b) page = <DocumentRedirect id={b} go={go} />;
  else if (section === "e" && a === "document") page = <DocumentsPage route={route} go={go} />;
  else if (section === "e" && a && ws.registry.has(a))
    page = b ? (
      <EntityFormPage key={`${a}/${b}`} entityKey={a} id={b} route={route} go={go} />
    ) : (
      <EntityListPage key={a} entityKey={a} route={route} go={go} />
    );
  else if (section === "documents") page = <DocumentsPage route={route} go={go} />;
  else if (section === "d" && a && b)
    page = <DocumentEditor key={`${a}/${b}`} type={a} id={b} go={go} />;
  else if (section === "deadlines") page = <DeadlinesPage />;
  else if (section === "journal") page = <JournalPage />;
  else if (section === "pipeline") page = <PipelinePage go={go} />;
  else if (section === "calendar") page = <CalendarPage go={go} />;
  else if (section === "inventory") page = <InventoryPage />;
  else if (section === "reports") page = <ReportsPage />;
  else if (section === "monitor") page = <MonitorPage />;
  else if (section === "server")
    page = (
      <SystemStatusPage
        serverUrl={serverUrl}
        status={status}
        onOpenSettings={() => go("settings")}
      />
    );
  else if (section === "settings")
    page = (
      <SettingsPage
        serverUrl={serverUrl}
        onServerUrlChange={changeServerUrl}
        theme={theme}
        onThemeChange={setTheme}
      />
    );
  else page = <p className="text-sm text-muted">Pagina non trovata.</p>;

  return (
    <div className="flex h-full">
      <Sidebar path={path} onNavigate={go} connection={status.state} />
      <div className="flex min-w-0 flex-1 flex-col">
        {volatile ? (
          <div role="status" className="bg-warning/15 px-8 py-1.5 text-xs text-warning">
            Modalità sviluppo nel browser: i dati sono in memoria e si perdono alla chiusura.
          </div>
        ) : null}
        <TopBar go={go} />
        <main className="flex-1 overflow-y-auto px-8 py-8">{page}</main>
      </div>
    </div>
  );
}
