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
import { SyncCard } from "./SyncCard";

interface Props {
  serverUrl: string | null;
  onServerUrlChange: (url: string | null) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function SettingsPage({ serverUrl, onServerUrlChange, theme, onThemeChange }: Props) {
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

  return (
    <>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <div className="grid max-w-3xl gap-4">
        <CompanyCard />
        <ShellCard />
        <DataCard />
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
              {serverUrl !== null && (
                <a className="self-center text-sm text-accent hover:underline" href="#/server">
                  {t.settings.serverStatusLink}
                </a>
              )}
            </div>
          </form>
        </Card>

        <SyncCard serverUrl={serverUrl} />

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
              {systemInfo ? `${systemInfo.os} · ${systemInfo.arch}` : t.settings.browserRuntime}
            </dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
