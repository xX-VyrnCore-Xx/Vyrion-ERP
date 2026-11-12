import { useState, type FormEvent } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { ValidationError } from "../data/errors";
import { COMPANY_FIELDS, getCompany, saveCompany } from "../modules/company";
import { Field } from "../ui/Field";
import { layoutFields } from "../ui/formLayout";
import { ErrorNote } from "../ui/parts";

/** The company that uses the app: name, legal form and — separately — the tax regime. */
export function CompanyCard({ onSaved }: { onSaved?: () => void }) {
  const ws = useWorkspace();
  const company = useAsync(() => getCompany(ws.db), []);
  if (company.loading) return null;
  return (
    <CompanyForm key={company.data ? "has" : "new"} initial={company.data} onSaved={onSaved} />
  );
}

function CompanyForm({
  initial,
  onSaved,
}: {
  initial: Record<string, unknown> | null;
  onSaved: (() => void) | undefined;
}) {
  const ws = useWorkspace();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      COMPANY_FIELDS.map((f) => [
        f.name,
        initial ? String(initial[f.name] ?? "") : String(f.default ?? ""),
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setSaved(false);
    try {
      await saveCompany(ws.db, values, ws.ctx.now());
      setErrors({});
      setSaved(true);
      ws.touch();
      onSaved?.();
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrors(error.errors);
        setMessage("Controlla i campi evidenziati.");
      } else setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Card title="Azienda">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid grid-cols-12 gap-x-4 gap-y-4">
          {layoutFields(COMPANY_FIELDS).map(({ field, className }) => (
            <div key={field.name} className={`min-w-0 ${className}`}>
              <Field
                field={field}
                value={values[field.name] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [field.name]: v }))}
                error={errors[field.name]}
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          La forma giuridica e il regime fiscale sono due scelte indipendenti. Il regime vale per i
          nuovi documenti; quelli già creati mantengono il regime con cui sono nati.
        </p>
        <div className="mt-3">
          <ErrorNote message={message} />
        </div>
        {saved ? (
          <p role="status" className="mt-2 text-sm text-success">
            Dati salvati.
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="mt-4">
          Salva
        </Button>
      </form>
    </Card>
  );
}
