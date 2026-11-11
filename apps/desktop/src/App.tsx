import { useCallback, useState } from "react";

import { Sidebar, type View } from "./components/Sidebar";
import { useServerStatus } from "./hooks/useServerStatus";
import { useTheme } from "./hooks/useTheme";
import { loadServerUrl, saveServerUrl } from "./lib/serverUrl";
import { SettingsPage } from "./pages/SettingsPage";
import { SystemStatusPage } from "./pages/SystemStatusPage";

export function App() {
  const [view, setView] = useState<View>("status");
  const [serverUrl, setServerUrl] = useState<string | null>(loadServerUrl);
  const [theme, setTheme] = useTheme();
  const status = useServerStatus(serverUrl);

  const changeServerUrl = useCallback((url: string | null) => {
    saveServerUrl(url);
    setServerUrl(url);
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar current={view} onNavigate={setView} connection={status.state} />
      <main className="flex-1 overflow-y-auto px-8 py-8">
        {view === "status" ? (
          <SystemStatusPage
            serverUrl={serverUrl}
            status={status}
            onOpenSettings={() => setView("settings")}
          />
        ) : (
          <SettingsPage
            serverUrl={serverUrl}
            onServerUrlChange={changeServerUrl}
            theme={theme}
            onThemeChange={setTheme}
          />
        )}
      </main>
    </div>
  );
}
