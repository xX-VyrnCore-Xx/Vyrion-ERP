import { NAV } from "../app/nav";
import type { Registry } from "../data/registry";

/** Something the search can take the person to without looking inside the data. */
export interface CatalogItem {
  id: string;
  kind: "page" | "action";
  title: string;
  /** Where it lives, shown under the title ("CRM", "Impostazioni"). */
  subtitle?: string;
  /** Hash path without "#/". */
  to: string;
  /** Extra words that should find it. */
  keywords: string[];
}

/** Kinds of record that are made by the software itself, not typed in by hand. */
const NOT_CREATABLE = new Set([
  "attachment",
  "document",
  "document_line",
  "journal_line",
  "company",
  "backup_run",
]);

const NEW_DOCUMENTS: { type: string; title: string; keywords: string[] }[] = [
  { type: "invoice", title: "Nuova fattura", keywords: ["emetti fattura", "fatturare", "invoice"] },
  { type: "quote", title: "Nuovo preventivo", keywords: ["offerta", "proposta", "stima"] },
  { type: "order", title: "Nuovo ordine", keywords: ["order"] },
  { type: "credit_note", title: "Nuova nota di credito", keywords: ["storno", "rimborso"] },
  {
    type: "purchase_invoice",
    title: "Nuova fattura di acquisto",
    keywords: ["spesa", "costo", "fornitore"],
  },
];

const SETTINGS: CatalogItem[] = [
  {
    id: "set:profile",
    kind: "page",
    title: "Profilo e azienda",
    subtitle: "Impostazioni",
    to: "settings/profile",
    keywords: [
      "ragione sociale",
      "partita iva",
      "codice fiscale",
      "regime fiscale",
      "dati aziendali",
      "indirizzo",
      "iban",
      "aliquota iva",
      "profilo",
    ],
  },
  {
    id: "set:account",
    kind: "page",
    title: "Account e server",
    subtitle: "Impostazioni",
    to: "settings/account",
    keywords: [
      "server aziendale",
      "sincronizzazione",
      "collega",
      "accedi",
      "email",
      "password",
      "online",
      "conflitti",
    ],
  },
  {
    id: "set:app",
    kind: "page",
    title: "Impostazioni software",
    subtitle: "Impostazioni",
    to: "settings/app",
    keywords: [
      "tema scuro",
      "tema chiaro",
      "aspetto",
      "barra delle applicazioni",
      "tray",
      "chiudi",
      "esci",
      "versione",
      "informazioni",
    ],
  },
  {
    id: "set:updates",
    kind: "page",
    title: "Aggiornamenti",
    subtitle: "Impostazioni",
    to: "settings/updates",
    keywords: ["nuova versione", "controlla aggiornamenti", "update", "novità"],
  },
  {
    id: "set:data",
    kind: "page",
    title: "Dati e backup",
    subtitle: "Impostazioni",
    to: "settings/data",
    keywords: [
      "esporta",
      "importa",
      "ripristina",
      "copia dei dati",
      "cifratura",
      "database",
      "integrità",
      "archivio",
    ],
  },
];

/** What else people may call a page. */
const EXTRA_KEYWORDS: Record<string, string[]> = {
  "billing-hours": ["fatturare ore", "ore assistenza", "interventi da fatturare", "tariffa oraria"],
  "accountant-export": [
    "commercialista",
    "pacchetto",
    "zip",
    "esportare",
    "prima nota",
    "consulente",
    "fine anno",
    "registri",
  ],
  payroll: [
    "stipendi",
    "cedolino",
    "busta paga",
    "timbratore",
    "ore lavorate",
    "straordinari",
    "costo del lavoro",
    "inps",
    "retribuzioni",
  ],
  vat: [
    "registro vendite",
    "registro acquisti",
    "liquidazione iva",
    "acconto iva",
    "iva da versare",
    "f24 iva",
    "protocollo acquisti",
  ],
  closing: ["chiudere anno", "bilancio", "utile", "perdita", "stato patrimoniale", "fine anno"],
  "fixed-assets": [
    "ammortamento",
    "ammortizzare",
    "beni durevoli",
    "immobilizzazioni",
    "computer ammortizzato",
  ],
  reconciliation: [
    "estratto conto",
    "banca",
    "movimenti bancari",
    "quadratura banca",
    "abbinare pagamenti",
  ],
  duplicates: ["doppioni", "unisci", "unire clienti", "anagrafiche doppie", "stesso cliente"],
  "": ["home", "dashboard", "avvisi", "indicatori", "riepilogo", "oggi"],
  deadlines: [
    "fatture scadute",
    "crediti da incassare",
    "debiti da pagare",
    "incassi",
    "pagamenti in ritardo",
    "insoluti",
    "scadenze",
  ],
  journal: ["registrazioni contabili", "partita doppia", "scritture", "libro giornale"],
  reports: ["statistiche", "ricavi", "andamento", "grafici", "bilancio"],
  inventory: ["giacenze", "scorte", "magazzino", "sotto scorta", "quantità"],
  monitor: ["ping", "uptime", "raggiungibilità", "controlli di rete", "stato dei servizi"],
  pipeline: ["trattative", "lead", "opportunità per fase", "vendite"],
  calendar: [
    "appuntamenti",
    "riunioni",
    "agenda del mese",
    "calendario",
    "ics",
    "esporta calendario",
    "importa calendario",
    "outlook",
    "google calendar",
    "promemoria",
  ],
};

/** Builds the list of pages and quick actions from the menu and from the kinds of record. */
export function buildCatalog(registry: Registry): CatalogItem[] {
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  const add = (item: CatalogItem) => {
    if (seen.has(item.to)) return;
    seen.add(item.to);
    items.push(item);
  };

  // actions first: they win when a page and an action share the same words
  for (const doc of NEW_DOCUMENTS) {
    add({
      id: `new:d/${doc.type}`,
      kind: "action",
      title: doc.title,
      subtitle: "Azione",
      to: `d/${doc.type}/new`,
      keywords: doc.keywords,
    });
  }
  for (const def of registry.entities) {
    if (NOT_CREATABLE.has(def.key)) continue;
    const feminine = /a$/.test(def.label.trim().split(" ")[0] ?? "");
    add({
      id: `new:e/${def.key}`,
      kind: "action",
      title: `${feminine ? "Nuova" : "Nuovo"} ${def.label.toLowerCase()}`,
      subtitle: "Azione",
      to: `e/${def.key}/new`,
      keywords: [def.plural, def.label],
    });
  }

  for (const section of NAV) {
    for (const item of section.items) {
      add({
        id: `nav:${item.to}`,
        kind: "page",
        title: item.label,
        subtitle: section.title ?? undefined,
        to: item.to,
        keywords: EXTRA_KEYWORDS[item.to] ?? [],
      });
      for (const child of item.children ?? []) {
        add({
          id: `nav:${child.to}`,
          kind: "page",
          title: `${item.label} · ${child.label}`,
          subtitle: section.title ?? undefined,
          to: child.to,
          keywords: [child.label],
        });
      }
    }
  }
  for (const item of SETTINGS) add(item);
  // every kind of record has a list, even when the menu does not name it
  for (const def of registry.entities) {
    if (NOT_CREATABLE.has(def.key) && def.key !== "document") continue;
    add({
      id: `list:${def.key}`,
      kind: "page",
      title: def.plural,
      subtitle: "Elenco",
      to: `e/${def.key}`,
      keywords: [def.label],
    });
  }
  return items;
}
