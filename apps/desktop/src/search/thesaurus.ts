import { editDistance, normalize, stem, typoBudget, words } from "./text";

/**
 * The vocabulary of the software, in groups of words that mean the same thing (Italian and
 * English, everyday and technical). A word in a group finds everything the group stands for.
 * `entities` are the kinds of record the group talks about: they are ranked higher when the
 * query uses one of its words.
 */
interface Group {
  id: string;
  terms: string[];
  entities?: string[];
}

export const GROUPS: Group[] = [
  {
    id: "cliente",
    terms: [
      "cliente",
      "clienti",
      "customer",
      "committente",
      "acquirente",
      "buyer",
      "azienda cliente",
    ],
    entities: ["party"],
  },
  {
    id: "fornitore",
    terms: ["fornitore", "fornitori", "supplier", "vendor", "fornitura"],
    entities: ["party"],
  },
  {
    id: "anagrafica",
    terms: [
      "cliente",
      "clienti",
      "fornitore",
      "fornitori",
      "anagrafica",
      "anagrafiche",
      "rubrica",
      "soggetto",
      "controparte",
      "party",
      "ditta",
      "societa",
    ],
    entities: ["party"],
  },
  {
    id: "contatto",
    terms: ["contatto", "contatti", "referente", "persona", "interlocutore", "contact"],
    entities: ["contact"],
  },
  {
    id: "fattura",
    terms: [
      "fattura",
      "fatture",
      "invoice",
      "fatturazione",
      "documento fiscale",
      "fatturato",
      "bolla",
    ],
    entities: ["document"],
  },
  {
    id: "preventivo",
    terms: ["preventivo", "preventivi", "quote", "offerta", "offerte", "proposta", "stima"],
    entities: ["document"],
  },
  {
    id: "ordine",
    terms: ["ordine", "ordini", "order", "commessa cliente", "conferma d'ordine"],
    entities: ["document"],
  },
  {
    id: "storno",
    terms: [
      "nota di credito",
      "note di credito",
      "storno",
      "rimborso",
      "credit note",
      "nota credito",
    ],
    entities: ["document"],
  },
  {
    id: "acquisto",
    terms: [
      "acquisto",
      "acquisti",
      "fattura di acquisto",
      "spesa",
      "spese",
      "costo",
      "costi",
      "purchase",
    ],
    entities: ["document"],
  },
  {
    id: "pagamento",
    terms: [
      "pagamento",
      "pagamenti",
      "incasso",
      "incassi",
      "bonifico",
      "payment",
      "saldo",
      "versamento",
      "pagato",
      "incassato",
    ],
    entities: ["payment"],
  },
  {
    id: "scadenza",
    terms: [
      "scadenza",
      "scadenze",
      "scaduto",
      "scaduti",
      "scadenzario",
      "ritardo",
      "insoluto",
      "insoluti",
      "deadline",
      "due",
      "overdue",
      "credito",
      "crediti",
      "debito",
      "debiti",
    ],
    entities: ["payment"],
  },
  {
    id: "ticket",
    terms: [
      "ticket",
      "assistenza",
      "supporto",
      "helpdesk",
      "segnalazione",
      "problema",
      "guasto",
      "richiesta",
      "support",
    ],
    entities: ["ticket"],
  },
  {
    id: "intervento",
    terms: [
      "intervento",
      "interventi",
      "intervention",
      "riparazione",
      "manutenzione",
      "lavoro svolto",
    ],
    entities: ["ticket_intervention"],
  },
  {
    id: "contratto",
    terms: [
      "contratto",
      "contratti",
      "contract",
      "accordo",
      "canone",
      "abbonamento",
      "rinnovo",
      "subscription",
    ],
    entities: ["contract"],
  },
  {
    id: "opportunita",
    terms: [
      "opportunita",
      "trattativa",
      "trattative",
      "lead",
      "deal",
      "pipeline",
      "vendita",
      "vendite",
      "prospect",
      "affare",
    ],
    entities: ["opportunity"],
  },
  {
    id: "comunicazione",
    terms: [
      "comunicazione",
      "comunicazioni",
      "email",
      "mail",
      "telefonata",
      "chiamata",
      "messaggio",
      "nota",
      "note",
      "interazione",
      "call",
    ],
    entities: ["communication"],
  },
  {
    id: "appuntamento",
    terms: [
      "appuntamento",
      "appuntamenti",
      "agenda",
      "calendario",
      "riunione",
      "meeting",
      "incontro",
      "evento",
      "calendar",
    ],
    entities: ["appointment"],
  },
  {
    id: "attivita",
    terms: ["attivita", "task", "compito", "compiti", "todo", "da fare", "promemoria", "reminder"],
    entities: ["task"],
  },
  {
    id: "progetto",
    terms: ["progetto", "progetti", "project", "commessa", "commesse", "cantiere"],
    entities: ["project"],
  },
  {
    id: "ore",
    terms: ["ore", "timesheet", "ore lavorate", "tempo", "rendicontazione", "time entry", "ora"],
    entities: ["time_entry"],
  },
  {
    id: "dipendente",
    terms: [
      "dipendente",
      "dipendenti",
      "personale",
      "staff",
      "collaboratore",
      "collaboratori",
      "employee",
      "risorsa",
      "risorse umane",
      "hr",
    ],
    entities: ["employee"],
  },
  {
    id: "assenza",
    terms: ["assenza", "assenze", "ferie", "permesso", "permessi", "malattia", "leave", "congedo"],
    entities: ["leave"],
  },
  {
    id: "prodotto",
    terms: [
      "prodotto",
      "prodotti",
      "articolo",
      "articoli",
      "product",
      "merce",
      "servizio",
      "servizi",
      "listino",
      "catalogo",
      "sku",
    ],
    entities: ["product"],
  },
  {
    id: "magazzino",
    terms: [
      "magazzino",
      "giacenza",
      "giacenze",
      "stock",
      "scorta",
      "scorte",
      "inventory",
      "movimento",
      "movimenti",
      "carico",
      "scarico",
    ],
    entities: ["stock_movement", "product"],
  },
  {
    id: "contabilita",
    terms: [
      "prima nota",
      "contabilita",
      "registrazione",
      "registrazioni",
      "journal",
      "scrittura",
      "scritture",
      "partita doppia",
      "libro giornale",
    ],
    entities: ["journal_entry"],
  },
  {
    id: "conto",
    terms: ["conto", "conti", "piano dei conti", "account contabile", "mastro", "bilancio"],
    entities: ["account"],
  },
  {
    id: "report",
    terms: [
      "report",
      "rapporto",
      "statistiche",
      "analisi",
      "andamento",
      "ricavi",
      "fatturato annuo",
      "grafico",
      "kpi",
      "indicatori",
      "dashboard",
    ],
  },
  {
    id: "asset",
    terms: [
      "asset",
      "dispositivo",
      "dispositivi",
      "computer",
      "pc",
      "portatile",
      "notebook",
      "server",
      "macchina",
      "hardware",
      "attrezzatura",
      "apparato",
      "inventario it",
    ],
    entities: ["asset"],
  },
  {
    id: "rete",
    terms: ["rete", "reti", "network", "lan", "vlan", "subnet", "sottorete", "wifi"],
    entities: ["network"],
  },
  {
    id: "ip",
    terms: ["ip", "indirizzo ip", "indirizzi ip", "address", "host", "dns", "ipv4", "ipv6"],
    entities: ["ip_address"],
  },
  {
    id: "vpn",
    terms: ["vpn", "wireguard", "tunnel", "peer", "accesso remoto", "remote access"],
    entities: ["vpn_peer"],
  },
  {
    id: "account",
    terms: [
      "account",
      "utente",
      "utenti",
      "credenziali",
      "login",
      "accesso",
      "accessi",
      "password",
      "user",
      "profilo",
    ],
    entities: ["it_account"],
  },
  {
    id: "licenza",
    terms: [
      "licenza",
      "licenze",
      "license",
      "licence",
      "software",
      "abbonamento software",
      "seriale",
      "chiave prodotto",
      "scadenza licenza",
    ],
    entities: ["license"],
  },
  {
    id: "backup",
    terms: [
      "backup",
      "copia",
      "copie",
      "salvataggio",
      "ripristino",
      "restore",
      "snapshot",
      "esecuzione backup",
    ],
    entities: ["backup_job", "backup_run"],
  },
  {
    id: "sicurezza",
    terms: [
      "sicurezza",
      "security",
      "vulnerabilita",
      "incidente",
      "evento di sicurezza",
      "minaccia",
      "attacco",
      "allarme",
      "cve",
      "patch",
    ],
    entities: ["security_event"],
  },
  {
    id: "monitoraggio",
    terms: [
      "monitor",
      "monitoraggio",
      "controllo",
      "controlli",
      "ping",
      "uptime",
      "stato rete",
      "raggiungibile",
      "check",
    ],
    entities: ["monitor_check"],
  },
  {
    id: "documentazione",
    terms: [
      "documentazione",
      "manuale",
      "wiki",
      "procedura",
      "guida",
      "istruzioni",
      "knowledge base",
      "howto",
      "tutorial",
      "documentation",
    ],
    entities: ["tech_doc"],
  },
  {
    id: "azienda",
    terms: [
      "azienda",
      "ragione sociale",
      "partita iva",
      "p.iva",
      "codice fiscale",
      "company",
      "dati aziendali",
      "sede",
      "intestazione",
    ],
  },
  {
    id: "impostazioni",
    terms: [
      "impostazioni",
      "settings",
      "preferenze",
      "configurazione",
      "opzioni",
      "options",
      "setup",
      "personalizza",
    ],
  },
  {
    id: "tema",
    terms: [
      "tema",
      "scuro",
      "chiaro",
      "dark",
      "light",
      "aspetto",
      "colori",
      "theme",
      "modalita notte",
    ],
  },
  {
    id: "aggiornamenti",
    terms: [
      "aggiornamento",
      "aggiornamenti",
      "update",
      "versione",
      "nuova versione",
      "upgrade",
      "novita",
    ],
  },
  {
    id: "dati",
    terms: [
      "dati",
      "backup dati",
      "archivio",
      "esporta",
      "esportazione",
      "importa",
      "ripristina",
      "database",
      "export",
      "cifratura",
      "chiave di cifratura",
    ],
  },
  {
    id: "sincronizzazione",
    terms: [
      "sincronizzazione",
      "sincronizza",
      "sync",
      "server",
      "collegamento",
      "conflitto",
      "conflitti",
      "cloud",
      "online",
    ],
  },
  {
    id: "nuovo",
    terms: [
      "nuovo",
      "nuova",
      "nuovi",
      "nuove",
      "crea",
      "creare",
      "aggiungi",
      "aggiungere",
      "inserisci",
      "registra",
      "emetti",
      "new",
      "add",
      "create",
    ],
  },
];

const byTerm = new Map<string, Set<string>>();
const entitiesOf = new Map<string, string[]>();

function register(term: string, id: string) {
  const parts = words(term);
  // single words are indexed by their stem; phrases by the whole normalized text
  const keys = parts.length === 1 ? [stem(parts[0] ?? "")] : [normalize(term)];
  for (const key of keys) {
    if (!key) continue;
    const set = byTerm.get(key) ?? new Set<string>();
    set.add(id);
    byTerm.set(key, set);
  }
}

for (const group of GROUPS) {
  for (const term of group.terms) register(term, group.id);
  entitiesOf.set(group.id, group.entities ?? []);
}

/** The concept groups a word (or a phrase) belongs to. */
export function conceptsOf(wordOrPhrase: string): string[] {
  const parts = words(wordOrPhrase);
  if (parts.length === 0) return [];
  const found = new Set<string>();
  if (parts.length > 1) for (const id of byTerm.get(normalize(wordOrPhrase)) ?? []) found.add(id);
  for (const part of parts) for (const id of byTerm.get(stem(part)) ?? []) found.add(id);
  return [...found];
}

/** The concept groups named anywhere in a text, also by multi-word phrases. */
export function conceptsInText(text: string): Set<string> {
  const norm = normalize(text);
  const found = new Set<string>();
  for (const [key, ids] of byTerm) {
    if (key.includes(" ") && norm.includes(key)) for (const id of ids) found.add(id);
  }
  for (const part of words(text)) for (const id of byTerm.get(stem(part)) ?? []) found.add(id);
  return found;
}

/** The kinds of record a concept refers to. */
export const entitiesOfConcept = (id: string): string[] => entitiesOf.get(id) ?? [];

/** Other words that mean the same as the given one (for "Cerco anche…"). */
export function synonymsOf(wordOrPhrase: string, max = 4): string[] {
  const own = new Set(words(wordOrPhrase).map(stem));
  const out: string[] = [];
  for (const id of conceptsOf(wordOrPhrase)) {
    const group = GROUPS.find((g) => g.id === id);
    for (const term of group?.terms ?? []) {
      const parts = words(term);
      if (parts.length === 1 && own.has(stem(parts[0] ?? ""))) continue;
      if (out.length < max && !out.includes(term)) out.push(term);
    }
  }
  return out.slice(0, max);
}

/** Every word of the vocabulary, for "Intendevi…?". */
export const VOCABULARY: string[] = [
  ...new Set(GROUPS.flatMap((g) => g.terms).flatMap((t) => words(t))),
];

/**
 * The concepts of the vocabulary word a mistyped word is closest to ("clinte" → "cliente").
 * Used only to find pages and actions, never to decide what a record contains.
 */
export function fuzzyConceptsOf(word: string): string[] {
  const budget = typoBudget(word.length);
  if (budget === 0) return [];
  const sw = stem(word);
  let best: string | null = null;
  let bestDistance = budget + 1;
  for (const v of VOCABULARY) {
    if (Math.abs(v.length - word.length) > budget) continue;
    const d = Math.min(editDistance(word, v, budget), editDistance(sw, stem(v), budget));
    if (d < bestDistance) {
      bestDistance = d;
      best = v;
    }
  }
  return best && bestDistance <= budget ? conceptsOf(best) : [];
}
