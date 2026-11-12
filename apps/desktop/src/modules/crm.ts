import type { EntityDef, Rec } from "../data/entity";
import { LockedError, ValidationError } from "../data/errors";
import { iban, opts, PRIORITY, taxCode, vatNumber } from "./common";

export const PARTY_KINDS = opts([
  ["lead", "Potenziale cliente"],
  ["customer", "Cliente"],
  ["supplier", "Fornitore"],
  ["partner", "Partner"],
]);
export const LEGAL_FORMS = opts([
  ["individual", "Persona fisica / ditta individuale"],
  ["freelance", "Libero professionista"],
  ["srl", "S.r.l."],
  ["srls", "S.r.l.s."],
  ["spa", "S.p.A."],
  ["snc", "S.n.c."],
  ["sas", "S.a.s."],
  ["other", "Altro"],
]);
export const STAGE_KINDS = opts([
  ["open", "In corso"],
  ["won", "Vinta"],
  ["lost", "Persa"],
]);
export const TASK_STATUS = opts([
  ["todo", "Da fare"],
  ["doing", "In corso"],
  ["done", "Completata"],
  ["cancelled", "Annullata"],
]);
export const TICKET_STATUS = opts([
  ["open", "Aperto"],
  ["in_progress", "In lavorazione"],
  ["waiting", "In attesa del cliente"],
  ["resolved", "Risolto"],
  ["closed", "Chiuso"],
]);
export const CONTRACT_STATUS = opts([
  ["draft", "Bozza"],
  ["active", "Attivo"],
  ["expired", "Scaduto"],
  ["terminated", "Disdetto"],
]);
export const COMM_KINDS = opts([
  ["call", "Telefonata"],
  ["email", "Email"],
  ["meeting", "Incontro"],
  ["note", "Nota"],
]);

const party: EntityDef = {
  key: "party",
  module: "crm",
  label: "Anagrafica",
  plural: "Anagrafiche",
  table: "parties",
  title: (r) => String(r["name"]),
  defaultOrder: "name asc",
  fields: [
    {
      name: "name",
      label: "Ragione sociale / Nome",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    {
      name: "kind",
      label: "Tipo",
      type: "select",
      options: PARTY_KINDS,
      required: true,
      default: "lead",
      list: true,
    },
    { name: "legal_form", label: "Forma giuridica", type: "select", options: LEGAL_FORMS },
    vatNumber(),
    taxCode(),
    { name: "sdi_code", label: "Codice SDI", type: "text", maxLength: 7 },
    { name: "pec", label: "PEC", type: "email" },
    { name: "email", label: "Email", type: "email", searchable: true, list: true },
    { name: "phone", label: "Telefono", type: "phone", list: true },
    { name: "website", label: "Sito web", type: "url" },
    { name: "address", label: "Indirizzo", type: "text" },
    { name: "zip", label: "CAP", type: "text", maxLength: 5 },
    { name: "city", label: "Città", type: "text", searchable: true },
    { name: "province", label: "Provincia", type: "text", maxLength: 2 },
    { name: "country", label: "Paese", type: "text", default: "IT", maxLength: 2 },
    iban(),
    {
      name: "hourly_rate",
      label: "Tariffa oraria (assistenza)",
      type: "money",
      min: 0,
      help: "Usata per fatturare le ore degli interventi sui ticket.",
    },
    {
      name: "payment_terms_days",
      label: "Pagamento (giorni)",
      type: "integer",
      min: 0,
      max: 365,
      default: 30,
    },
    { name: "notes", label: "Note", type: "longtext" },
  ],
};

const contact: EntityDef = {
  key: "contact",
  module: "crm",
  label: "Contatto",
  plural: "Contatti",
  table: "contacts",
  title: (r) => `${r["first_name"] ?? ""} ${r["last_name"]}`.trim(),
  defaultOrder: "last_name asc",
  fields: [
    {
      name: "party_id",
      label: "Anagrafica",
      type: "ref",
      ref: "party",
      required: true,
      list: true,
    },
    { name: "first_name", label: "Nome", type: "text", searchable: true, list: true },
    {
      name: "last_name",
      label: "Cognome",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "role", label: "Ruolo", type: "text" },
    { name: "email", label: "Email", type: "email", searchable: true, list: true },
    { name: "phone", label: "Telefono", type: "phone" },
    { name: "mobile", label: "Cellulare", type: "phone" },
    { name: "notes", label: "Note", type: "longtext" },
  ],
};

const stage: EntityDef = {
  key: "pipeline_stage",
  module: "crm",
  label: "Fase",
  plural: "Fasi della pipeline",
  table: "pipeline_stages",
  title: (r) => String(r["name"]),
  defaultOrder: "position asc",
  fields: [
    { name: "name", label: "Nome", type: "text", required: true, unique: true, list: true },
    { name: "position", label: "Ordine", type: "integer", required: true, min: 0, list: true },
    { name: "probability", label: "Probabilità %", type: "percent", default: 0, list: true },
    {
      name: "kind",
      label: "Esito",
      type: "select",
      options: STAGE_KINDS,
      required: true,
      default: "open",
      list: true,
    },
  ],
};

const opportunity: EntityDef = {
  key: "opportunity",
  module: "crm",
  label: "Opportunità",
  plural: "Opportunità",
  table: "opportunities",
  title: (r) => String(r["title"]),
  defaultOrder: "expected_close asc",
  fields: [
    { name: "title", label: "Titolo", type: "text", required: true, searchable: true, list: true },
    {
      name: "party_id",
      label: "Anagrafica",
      type: "ref",
      ref: "party",
      required: true,
      list: true,
    },
    {
      name: "stage_id",
      label: "Fase",
      type: "ref",
      ref: "pipeline_stage",
      required: true,
      list: true,
    },
    { name: "amount", label: "Valore", type: "money", default: 0, min: 0, list: true },
    { name: "expected_close", label: "Chiusura prevista", type: "date", list: true },
    { name: "closed_at", label: "Chiusa il", type: "date", readonly: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  // Entering a won/lost stage stamps the closing date; leaving it clears it.
  beforeSave: async ({ tx, ctx, record }) => {
    const [row] = await tx.query<{ kind: string }>(
      "SELECT kind FROM pipeline_stages WHERE id = ?",
      [record["stage_id"] as string],
    );
    if (row && row.kind !== "open") record["closed_at"] ??= ctx.today();
    else record["closed_at"] = null;
  },
};

const communication: EntityDef = {
  key: "communication",
  module: "crm",
  label: "Comunicazione",
  plural: "Comunicazioni",
  table: "communications",
  title: (r) => String(r["subject"]),
  defaultOrder: "occurred_at desc",
  fields: [
    {
      name: "party_id",
      label: "Anagrafica",
      type: "ref",
      ref: "party",
      required: true,
      list: true,
    },
    { name: "contact_id", label: "Contatto", type: "ref", ref: "contact" },
    {
      name: "kind",
      label: "Tipo",
      type: "select",
      options: COMM_KINDS,
      required: true,
      default: "note",
      list: true,
    },
    {
      name: "direction",
      label: "Direzione",
      type: "select",
      options: opts([
        ["in", "Ricevuta"],
        ["out", "Inviata"],
      ]),
    },
    {
      name: "subject",
      label: "Oggetto",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "body", label: "Testo", type: "longtext", searchable: true },
    { name: "occurred_at", label: "Data e ora", type: "datetime", required: true, list: true },
  ],
  beforeSave: async ({ tx, record }) => {
    if (!record["contact_id"]) return;
    const [row] = await tx.query<{ party_id: string }>(
      "SELECT party_id FROM contacts WHERE id = ?",
      [record["contact_id"] as string],
    );
    if (row && row.party_id !== record["party_id"]) {
      throw new ValidationError({ contact_id: "Il contatto appartiene a un'altra anagrafica" });
    }
  },
};

const appointment: EntityDef = {
  key: "appointment",
  module: "crm",
  label: "Appuntamento",
  plural: "Appuntamenti",
  table: "appointments",
  title: (r) => String(r["title"]),
  defaultOrder: "starts_at asc",
  fields: [
    { name: "title", label: "Titolo", type: "text", required: true, searchable: true, list: true },
    { name: "starts_at", label: "Inizio", type: "datetime", required: true, list: true },
    { name: "ends_at", label: "Fine", type: "datetime" },
    { name: "party_id", label: "Anagrafica", type: "ref", ref: "party" },
    { name: "location", label: "Luogo", type: "text" },
    {
      name: "reminder_minutes",
      label: "Promemoria (minuti prima)",
      type: "integer",
      min: 0,
      max: 20160,
      help: "Es. 15, 60 o 1440 (un giorno): compare tra gli avvisi prima dell'appuntamento.",
    },
    { name: "ics_uid", label: "Identificativo calendario", type: "text", hidden: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    const start = record["starts_at"] as string;
    const end = record["ends_at"] as string | null;
    if (end && end < start) throw new ValidationError({ ends_at: "La fine precede l'inizio" });
  },
};

const task: EntityDef = {
  key: "task",
  module: "crm",
  label: "Attività",
  plural: "Attività",
  table: "tasks",
  title: (r) => String(r["title"]),
  defaultOrder: "due_date asc",
  fields: [
    { name: "title", label: "Titolo", type: "text", required: true, searchable: true, list: true },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: TASK_STATUS,
      required: true,
      default: "todo",
      list: true,
    },
    {
      name: "priority",
      label: "Priorità",
      type: "select",
      options: PRIORITY,
      required: true,
      default: "normal",
      list: true,
    },
    { name: "due_date", label: "Scadenza", type: "date", list: true },
    {
      name: "remind_on",
      label: "Ricordamelo il",
      type: "date",
      help: "Da quel giorno compare tra gli avvisi finché l'attività non è completata.",
    },
    { name: "party_id", label: "Anagrafica", type: "ref", ref: "party" },
    { name: "completed_at", label: "Completata il", type: "date", readonly: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ ctx, record }) => {
    record["completed_at"] =
      record["status"] === "done"
        ? ((record["completed_at"] as string | null) ?? ctx.today())
        : null;
  },
};

const contract: EntityDef = {
  key: "contract",
  module: "crm",
  label: "Contratto",
  plural: "Contratti",
  table: "contracts",
  title: (r) => String(r["title"]),
  defaultOrder: "end_date asc",
  fields: [
    { name: "title", label: "Titolo", type: "text", required: true, searchable: true, list: true },
    {
      name: "party_id",
      label: "Anagrafica",
      type: "ref",
      ref: "party",
      required: true,
      list: true,
    },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: CONTRACT_STATUS,
      required: true,
      default: "draft",
      list: true,
    },
    { name: "start_date", label: "Inizio", type: "date", required: true },
    { name: "end_date", label: "Scadenza", type: "date", list: true },
    { name: "value", label: "Valore annuo", type: "money", default: 0, min: 0, list: true },
    {
      name: "notice_days",
      label: "Preavviso disdetta (giorni)",
      type: "integer",
      min: 0,
      max: 730,
      default: 30,
    },
    { name: "auto_renew", label: "Rinnovo automatico", type: "boolean", default: false },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    const start = record["start_date"] as string;
    const end = record["end_date"] as string | null;
    if (end && end < start) throw new ValidationError({ end_date: "La scadenza precede l'inizio" });
  },
};

const ticket: EntityDef = {
  key: "ticket",
  module: "crm",
  label: "Ticket",
  plural: "Ticket",
  table: "tickets",
  title: (r) => `${r["number"]} · ${r["subject"]}`,
  defaultOrder: "number desc",
  fields: [
    { name: "number", label: "Numero", type: "text", unique: true, readonly: true, list: true },
    {
      name: "party_id",
      label: "Anagrafica",
      type: "ref",
      ref: "party",
      required: true,
      list: true,
    },
    {
      name: "subject",
      label: "Oggetto",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "description", label: "Descrizione", type: "longtext", searchable: true },
    {
      name: "priority",
      label: "Priorità",
      type: "select",
      options: PRIORITY,
      required: true,
      default: "normal",
      list: true,
    },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: TICKET_STATUS,
      required: true,
      default: "open",
      list: true,
    },
    { name: "opened_at", label: "Aperto il", type: "date", readonly: true },
    { name: "closed_at", label: "Chiuso il", type: "date", readonly: true },
  ],
  beforeSave: async ({ tx, ctx, mode, before, record }) => {
    if (mode === "create") {
      const year = ctx.today().slice(0, 4);
      // Soft-deleted tickets still count, so a number is never handed out twice.
      const [row] = await tx.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM tickets WHERE number LIKE ?",
        [`T${year}-%`],
      );
      record["number"] = `T${year}-${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
      record["opened_at"] = ctx.today();
    }
    const finished = record["status"] === "resolved" || record["status"] === "closed";
    record["closed_at"] = finished
      ? ((before?.["closed_at"] as string | null) ?? ctx.today())
      : null;
  },
};

const intervention: EntityDef = {
  key: "ticket_intervention",
  module: "crm",
  label: "Intervento",
  plural: "Interventi",
  table: "ticket_interventions",
  title: (r: Rec) => `${r["performed_on"]} · ${r["minutes"]} min`,
  defaultOrder: "performed_on desc",
  fields: [
    { name: "ticket_id", label: "Ticket", type: "ref", ref: "ticket", required: true },
    { name: "performed_on", label: "Data", type: "date", required: true, list: true },
    {
      name: "minutes",
      label: "Minuti",
      type: "integer",
      required: true,
      min: 1,
      max: 1440,
      list: true,
    },
    { name: "notes", label: "Descrizione", type: "longtext", list: true },
    {
      name: "document_id",
      label: "Fatturato nel documento",
      type: "ref",
      ref: "document",
      readonly: true,
    },
  ],
  // Once billed, an intervention is part of an invoice and stays as it was; only the link to a
  // deleted draft can be cleared.
  beforeSave: ({ mode, before, record }) => {
    if (mode !== "update" || !before?.["document_id"]) return;
    const changed = ["ticket_id", "performed_on", "minutes", "notes"].some(
      (name) => before[name] !== record[name],
    );
    if (changed)
      throw new LockedError("L'intervento è già in una fattura: modificala o eliminala da lì");
  },
  beforeDelete: ({ record }) => {
    if (record["document_id"])
      throw new LockedError("L'intervento è già in una fattura: eliminala prima");
  },
};

export const CRM_ENTITIES: EntityDef[] = [
  party,
  contact,
  stage,
  opportunity,
  communication,
  appointment,
  task,
  contract,
  ticket,
  intervention,
];
