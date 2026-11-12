import { useState, type FormEvent } from "react";

import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorNote } from "../ui/parts";
import type { ServerCompany } from "./types";
import { useRemote } from "./useRemote";

const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg";
const FORMS: [string, string][] = [
  ["sole_proprietorship", "Ditta individuale / libero professionista"],
  ["srl", "S.r.l."],
  ["srls", "S.r.l.s."],
  ["spa", "S.p.A."],
];
const EMPTY = {
  legal_name: "",
  legal_form: "srl",
  tax_regime: "ordinario",
  vat_number: "",
  fiscal_code: "",
  street: "",
  postal_code: "",
  city: "",
  province: "",
  country_code: "IT",
};

/** The company data kept on the server and shared by every installation. */
export function CompanyPane() {
  const sync = useSync();
  const company = useRemote(
    () =>
      sync.request<ServerCompany>("GET", "/company").catch((e: unknown) => {
        if (e instanceof Error && /not.*configured|404|non.*configurat/i.test(e.message))
          return null;
        throw e;
      }),
    [],
  );
  const [form, setForm] = useState(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The form is filled once, when the data first arrives.
  const [seen, setSeen] = useState<ServerCompany | null>(null);
  if (company.data && company.data !== seen) {
    const c = company.data;
    setSeen(c);
    setForm({
      legal_name: c.legal_name,
      legal_form: c.legal_form,
      tax_regime: c.tax_regime,
      vat_number: c.vat_number,
      fiscal_code: c.fiscal_code,
      street: c.street,
      postal_code: c.postal_code,
      city: c.city,
      province: c.province,
      country_code: c.country_code,
    });
    setVersion(c.version);
  }

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMsg(null);
    try {
      const saved = await sync.request<ServerCompany>("PUT", "/company", {
        ...form,
        ...(version === null ? {} : { version }),
      });
      setVersion(saved.version);
      setMsg({ ok: true, text: "Dati dell'azienda salvati sul server." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const field = (label: string, key: keyof typeof EMPTY, extra = "") => (
    <label className={`block text-xs font-medium text-muted ${extra}`}>
      {label}
      <input className={`${INPUT} mt-1`} value={form[key]} onChange={set(key)} />
    </label>
  );

  return (
    <Card title="Azienda sul server">
      <ErrorNote message={company.error} />
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
        {field("Ragione sociale", "legal_name", "sm:col-span-2")}
        <label className="block text-xs font-medium text-muted">
          Forma giuridica
          <select className={`${INPUT} mt-1`} value={form.legal_form} onChange={set("legal_form")}>
            {FORMS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted">
          Regime fiscale
          <select className={`${INPUT} mt-1`} value={form.tax_regime} onChange={set("tax_regime")}>
            <option value="ordinario">Ordinario</option>
            <option value="forfettario">Forfettario</option>
          </select>
        </label>
        {field("Partita IVA", "vat_number")}
        {field("Codice fiscale", "fiscal_code")}
        {field("Indirizzo", "street", "sm:col-span-2")}
        {field("CAP", "postal_code")}
        {field("Città", "city")}
        {field("Provincia (sigla)", "province")}
        {field("Paese (sigla)", "country_code")}
        <div className="space-y-2 sm:col-span-2">
          {msg ? (
            msg.ok ? (
              <p role="status" className="text-sm text-success">
                {msg.text}
              </p>
            ) : (
              <ErrorNote message={msg.text} />
            )
          ) : null}
          <Button type="submit" variant="primary">
            {version === null ? "Crea azienda" : "Salva"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
