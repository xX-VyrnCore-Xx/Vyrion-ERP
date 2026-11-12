import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import type { Theme } from "../hooks/useTheme";
import { t } from "../i18n/it";
import { getSystemInfo, type SystemInfo } from "../lib/platform";
import { parseServerUrl, type ServerUrlError } from "../lib/serverUrl";
import { CompanyCard } from "./CompanyCard";
import { DataCard } from "./DataCard";
import { ShellCard } from "./ShellCard";
import { UpdateCard } from "./UpdateCard";
import { SyncCard } from "./SyncCard";

interface Props {
  serverUrl: string | null;
  onServerUrlChange: (url: string | null) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** Which section is open: the second part of the route ("settings/data"). */
  section?: string;
  go?: (to: string) => void;
}

export const SECTIONS = [
  { id: "profile", label: "Profilo e azienda", hint: "Dati dell'azienda e dei documenti" },
  { id: "account", label: "Account e server", hint: "Accesso al server e sincronizzazione" },
  { id: "app", label: "Applicazione", hint: "Comportamento, aspetto e informazioni" },
  { id: "updates", label: "Aggiornamenti", hint: "Versione installata e novità" },
  { id: "data", label: "Dati e backup", hint: "Archivio locale cifrato" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const isSection = (value: string | undefined): value is SectionId =>
  SECTIONS.some((s) => s.id === value);

export function SettingsPage({
  serverUrl,
  onServerUrlChange,
  theme,
  onThemeChange,
  section,
  go,
}: Props) {
  const current: SectionId = isSection(section) ? section : "profile";
  const inputId = useId();
  const helpId = useId();
  const [draft, setDraft] = useState(serverUrl ?? "");
  const [error, setError] = useState<ServerUrlError | null>(null);
  const [saved, setSaved] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    let active = true;
    void getSystemInfo().then((info) => {
      if (active) setSystemInfo(info);
    });
    return () => {
      active = false;
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = parseServerUrl(draft);
    if (!result.ok) {
      setError(result.error);
      setSaved(false);
      return;
    }
    setError(null);
    setDraft(result.url);
    setSaved(true);
    onServerUrlChange(result.url);
  };

  const remove = () => {
    setDraft("");
    setError(null);
    setSaved(false);
    onServerUrlChange(null);
  };

  const open = (id: SectionId) => (go ? go(`settings/${id}`) : undefined);
  const active = SECTIONS.find((s) => s.id === current);

  return (
    <>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <div className="flex max-w-5xl flex-col gap-6 md:flex-row">
        <nav aria-label="Sezioni delle impostazioni" className="md:w-52 md:shrink-0">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((item) => (
              <li key={item.id}>
                <a
                  href={`#/settings/${item.id}`}
                  aria-current={item.id === current ? "page" : undefined}
                  onClick={(e) => {
                    if (!go) return;
                    e.preventDefault();
                    open(item.id);
                  }}
                  className={`block whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] ${
                    item.id === current
                      ? "bg-raised font-medium text-fg"
                      : "text-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid min-w-0 flex-1 gap-4">
          <p className="-mb-1 text-xs text-muted">{active?.hint}</p>
          {current === "profile" ? <CompanyCard /> : null}
          {current === "account" ? (
            <>
              <Card title={t.settings.serverSection}>
                <p className="mb-4 text-sm text-muted">{t.settings.serverIntro}</p>
                <form onSubmit={submit} noValidate>
                  <label htmlFor={inputId} className="mb-1.5 block text-sm text-fg">
                    {t.settings.serverUrl}
                  </label>
                  <input
                    id={inputId}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft}
                    aria-invalid={error !== null}
                    aria-describedby={helpId}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setSaved(false);
                    }}
                    className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted aria-invalid:border-danger"
                    placeholder="https://"
                  />
                  <p id={helpId} className="mt-1.5 text-xs text-muted">
                    {t.settings.serverUrlHelp}
                  </p>
                  {error && (
                    <p role="alert" className="mt-2 text-sm text-danger">
                      {t.errors[error]}
                    </p>
                  )}
                  {saved && (
                    <p role="status" className="mt-2 text-sm text-success">
                      {t.settings.saved}
                    </p>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button type="submit" variant="primary">
                      {t.settings.save}
                    </Button>
                    {serverUrl !== null && <Button onClick={remove}>{t.settings.remove}</Button>}
                  </div>
                </form>
              </Card>

              <SyncCard serverUrl={serverUrl} />
            </>
          ) : null}
          {current === "app" ? (
            <>
              <ShellCard />
              <Card title={t.settings.appearance}>
                <fieldset>
                  <legend className="mb-2 text-sm text-fg">{t.settings.theme}</legend>
                  <div className="flex gap-2">
                    {(["dark", "light"] as const).map((option) => (
                      <label
                        key={option}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-fg has-checked:border-accent"
                      >
                        <input
                          type="radio"
                          name="theme"
                          value={option}
                          checked={theme === option}
                          onChange={() => onThemeChange(option)}
                          className="accent-(--accent)"
                        />
                        {option === "dark" ? t.settings.themeDark : t.settings.themeLight}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </Card>

              <Card title={t.settings.about}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-muted">{t.settings.appVersion}</dt>
                  <dd className="text-fg">{__APP_VERSION__}</dd>
                  <dt className="text-muted">{t.settings.platform}</dt>
                  <dd className="text-fg">
                    {systemInfo
                      ? `${systemInfo.os} · ${systemInfo.arch}`
                      : t.settings.browserRuntime}
                  </dd>
                </dl>
              </Card>
            </>
          ) : null}
          {current === "updates" ? <UpdateCard /> : null}
          {current === "data" ? <DataCard /> : null}
        </div>
      </div>
    </>
  );
}
