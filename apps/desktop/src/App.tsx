import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from "react";

import { AppContext, useAsync, useWorkspace } from "./app/context";
import { SyncProvider } from "./app/sync";
import { UpdatesProvider } from "./app/updates";
import { boot, type Booted } from "./app/boot";
import { useRoute } from "./app/router";
import { useSync } from "./app/sync";
import { useTrayEvents } from "./app/tray";
import type { Workspace } from "./data/workspace";
import { Sidebar } from "./components/Sidebar";
import { useServerStatus } from "./hooks/useServerStatus";
import { useTheme } from "./hooks/useTheme";
import { loadServerUrl, saveServerUrl } from "./lib/serverUrl";
import { trackVisibility } from "./lib/visibility";
import { DocumentRedirect } from "./pages/DocumentRedirect";
import { getCompany } from "./modules/company";
import { TopBar } from "./ui/TopBar";
import { UpdateBanner } from "./ui/UpdateBanner";

// Pages load on demand, so the window opens fast.
const CalendarPage = lazy(() =>
  import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const DeadlinesPage = lazy(() =>
  import("./pages/DeadlinesPage").then((m) => ({ default: m.DeadlinesPage })),
);
const DocumentEditor = lazy(() =>
  import("./pages/DocumentEditor").then((m) => ({ default: m.DocumentEditor })),
);
const DocumentsPage = lazy(() =>
  import("./pages/DocumentsPage").then((m) => ({ default: m.DocumentsPage })),
);
const PayrollPage = lazy(() =>
  import("./pages/PayrollPage").then((m) => ({ default: m.PayrollPage })),
);
const AccountantExportPage = lazy(() =>
  import("./pages/AccountantExportPage").then((m) => ({ default: m.AccountantExportPage })),
);
const VatPage = lazy(() => import("./pages/VatPage").then((m) => ({ default: m.VatPage })));
const BillingHoursPage = lazy(() =>
  import("./pages/BillingHoursPage").then((m) => ({ default: m.BillingHoursPage })),
);
const ClosingPage = lazy(() =>
  import("./pages/ClosingPage").then((m) => ({ default: m.ClosingPage })),
);
const FixedAssetsPage = lazy(() =>
  import("./pages/FixedAssetsPage").then((m) => ({ default: m.FixedAssetsPage })),
);
const ReconciliationPage = lazy(() =>
  import("./pages/ReconciliationPage").then((m) => ({ default: m.ReconciliationPage })),
);
const DuplicatesPage = lazy(() =>
  import("./pages/DuplicatesPage").then((m) => ({ default: m.DuplicatesPage })),
);
const EntityFormPage = lazy(() =>
  import("./pages/EntityFormPage").then((m) => ({ default: m.EntityFormPage })),
);
const EntityListPage = lazy(() =>
  import("./pages/EntityListPage").then((m) => ({ default: m.EntityListPage })),
);
const InventoryPage = lazy(() =>
  import("./pages/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);
const JournalPage = lazy(() =>
  import("./pages/JournalPage").then((m) => ({ default: m.JournalPage })),
);
const MonitorPage = lazy(() =>
  import("./pages/MonitorPage").then((m) => ({ default: m.MonitorPage })),
);
const PipelinePage = lazy(() =>
  import("./pages/PipelinePage").then((m) => ({ default: m.PipelinePage })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

const PAGES = [
  () => import("./pages/EntityListPage"),
  () => import("./pages/EntityFormPage"),
  () => import("./pages/DocumentsPage"),
  () => import("./pages/DocumentEditor"),
  () => import("./pages/PipelinePage"),
  () => import("./pages/CalendarPage"),
  () => import("./pages/SettingsPage"),
];

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
      <SyncProvider ws={booted.ws}>
        <UpdatesProvider>
          <Shell volatile={booted.volatile} />
        </UpdatesProvider>
      </SyncProvider>
    </AppContext.Provider>
  );
}

/** Shown for the moment a page's code is loading. */
function PageSkeleton() {
  return (
    <div role="status" aria-label="Caricamento" className="space-y-4">
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-4 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
    </div>
  );
}

/** Loads the pages' code while the app is idle, so that moving around feels instant. */
function usePreloadPages(): void {
  useEffect(() => {
    const load = () => {
      for (const page of PAGES) void page();
    };
    const idle = window.requestIdleCallback as ((cb: () => void) => number) | undefined;
    const id = idle ? idle(load) : window.setTimeout(load, 1500);
    return () => {
      if (idle && window.cancelIdleCallback) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);
}

function Shell({ volatile }: { volatile: boolean }) {
  const ws = useWorkspace();
  const [route, go] = useRoute();
  const [serverUrl, setServerUrl] = useState<string | null>(loadServerUrl);
  const [theme, setTheme] = useTheme();
  const status = useServerStatus(serverUrl);
  const company = useAsync(() => getCompany(ws.db), []);
  const sync = useSync();
  useTrayEvents(go, sync.syncNow);
  usePreloadPages();
  useEffect(() => trackVisibility(), []);

  const changeServerUrl = useCallback((url: string | null) => {
    saveServerUrl(url);
    setServerUrl(url);
  }, []);

  const path = route.path.join("/");
  const [section = "", a = "", b = ""] = route.path;
  let page: ReactNode;
  if (section === "") page = <DashboardPage />;
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
  else if (section === "duplicates") page = <DuplicatesPage />;
  else if (section === "vat") page = <VatPage />;
  else if (section === "payroll") page = <PayrollPage />;
  else if (section === "accountant-export") page = <AccountantExportPage />;
  else if (section === "billing-hours") page = <BillingHoursPage go={go} />;
  else if (section === "closing") page = <ClosingPage />;
  else if (section === "fixed-assets") page = <FixedAssetsPage />;
  else if (section === "reconciliation") page = <ReconciliationPage />;
  else if (section === "deadlines") page = <DeadlinesPage />;
  else if (section === "journal") page = <JournalPage />;
  else if (section === "pipeline") page = <PipelinePage go={go} />;
  else if (section === "calendar") page = <CalendarPage go={go} />;
  else if (section === "inventory") page = <InventoryPage />;
  else if (section === "reports") page = <ReportsPage />;
  else if (section === "monitor") page = <MonitorPage />;
  else if (section === "settings")
    page = (
      <SettingsPage
        serverUrl={serverUrl}
        onServerUrlChange={changeServerUrl}
        theme={theme}
        onThemeChange={setTheme}
        section={a}
        go={go}
      />
    );
  else page = <p className="text-sm text-muted">Pagina non trovata.</p>;

  return (
    <div className="flex h-full">
      <Sidebar
        place={{ path, query: route.query }}
        onNavigate={go}
        connection={status.state}
        companyName={company.data?.name ?? null}
        theme={theme}
        onThemeChange={setTheme}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {volatile ? (
          <div role="status" className="bg-warning/15 px-8 py-1.5 text-xs text-warning">
            Modalità sviluppo nel browser: i dati sono in memoria e si perdono alla chiusura.
          </div>
        ) : null}
        <TopBar go={go} />
        <UpdateBanner />
        {company.data === null && !company.loading && path !== "settings" ? (
          <div
            role="status"
            className="flex items-center justify-between gap-4 border-b border-line bg-accent/10 px-8 py-2 text-sm"
          >
            <span>
              Puoi usare subito tutti i moduli. I <strong>dati dell'azienda</strong> servono solo
              per emettere documenti: completali quando vuoi.
            </span>
            <button
              type="button"
              onClick={() => go("settings")}
              className="shrink-0 rounded-lg bg-[image:var(--gradient-accent)] px-3 py-1 text-xs font-medium text-accent-contrast shadow-glow hover:brightness-110"
            >
              Completa ora
            </button>
          </div>
        ) : null}
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <Suspense fallback={<PageSkeleton />}>
            {/* A new key per screen replays the short entrance animation. */}
            <div key={`${section}/${a}`} className="page-enter">
              {page}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
