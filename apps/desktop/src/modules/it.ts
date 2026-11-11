import type { EntityDef } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import { cidrContains, cidrOverlaps, isCidr } from "../lib/net";
import { opts } from "./common";

export const ASSET_CATEGORIES = opts([
  ["server", "Server"],
  ["workstation", "Postazione fissa"],
  ["laptop", "Portatile"],
  ["network", "Apparato di rete"],
  ["printer", "Stampante"],
  ["mobile", "Dispositivo mobile"],
  ["peripheral", "Periferica"],
  ["other", "Altro"],
]);
export const ASSET_STATUS = opts([
  ["in_stock", "A magazzino"],
  ["in_use", "In uso"],
  ["repair", "In riparazione"],
  ["retired", "Dismesso"],
]);
export const IP_KINDS = opts([
  ["static", "Statico"],
  ["dhcp", "DHCP"],
  ["reserved", "Riservato"],
]);
export const SEVERITY = opts([
  ["info", "Informativo"],
  ["low", "Bassa"],
  ["medium", "Media"],
  ["high", "Alta"],
  ["critical", "Critica"],
]);
export const EVENT_CATEGORIES = opts([
  ["access", "Accesso"],
  ["malware", "Malware"],
  ["phishing", "Phishing"],
  ["vulnerability", "Vulnerabilità"],
  ["data", "Dati"],
  ["other", "Altro"],
]);
export const EVENT_STATUS = opts([
  ["open", "Aperto"],
  ["investigating", "In analisi"],
  ["resolved", "Risolto"],
]);
export const RUN_STATUS = opts([
  ["success", "Riuscito"],
  ["warning", "Con avvisi"],
  ["failed", "Fallito"],
]);
export const DOC_CATEGORIES = opts([
  ["procedure", "Procedura"],
  ["config", "Configurazione"],
  ["howto", "Guida"],
  ["disaster", "Disaster recovery"],
  ["other", "Altro"],
]);

// WireGuard keys are 32 bytes in base64: 44 characters ending in "=".
const WG_KEY = /^[A-Za-z0-9+/]{43}=$/;

const asset: EntityDef = {
  key: "asset",
  module: "it",
  label: "Asset",
  plural: "Inventario IT",
  table: "assets",
  title: (r) => `${r["tag"]} · ${r["name"]}`,
  defaultOrder: "tag asc",
  fields: [
    {
      name: "tag",
      label: "Codice inventario",
      type: "text",
      required: true,
      unique: true,
      maxLength: 40,
      searchable: true,
      list: true,
    },
    { name: "name", label: "Nome", type: "text", required: true, searchable: true, list: true },
    {
      name: "category",
      label: "Categoria",
      type: "select",
      options: ASSET_CATEGORIES,
      required: true,
      default: "workstation",
      list: true,
    },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: ASSET_STATUS,
      required: true,
      default: "in_use",
      list: true,
    },
    { name: "manufacturer", label: "Produttore", type: "text", searchable: true },
    { name: "model", label: "Modello", type: "text", searchable: true },
    { name: "serial", label: "Numero di serie", type: "text", searchable: true },
    { name: "assigned_to", label: "Assegnato a", type: "ref", ref: "employee", list: true },
    { name: "location", label: "Posizione", type: "text" },
    { name: "purchase_date", label: "Acquisto", type: "date" },
    { name: "warranty_until", label: "Garanzia fino al", type: "date", list: true },
    { name: "purchase_cost", label: "Costo", type: "money", default: 0, min: 0 },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    const bought = record["purchase_date"] as string | null;
    const warranty = record["warranty_until"] as string | null;
    if (bought && warranty && warranty < bought)
      throw new ValidationError({ warranty_until: "La garanzia scade prima dell'acquisto" });
    if (record["status"] === "retired" && record["assigned_to"]) {
      throw new ValidationError({ assigned_to: "Un asset dismesso non può essere assegnato" });
    }
  },
};

const network: EntityDef = {
  key: "network",
  module: "it",
  label: "Rete",
  plural: "Reti",
  table: "networks",
  title: (r) => `${r["name"]} (${r["cidr"]})`,
  defaultOrder: "name asc",
  fields: [
    { name: "name", label: "Nome", type: "text", required: true, unique: true, list: true },
    { name: "cidr", label: "Rete (CIDR)", type: "cidr", required: true, list: true },
    { name: "vlan", label: "VLAN", type: "integer", min: 1, max: 4094, list: true },
    { name: "gateway", label: "Gateway", type: "ip" },
    { name: "dns", label: "DNS", type: "text", help: "Uno o più indirizzi separati da virgola" },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: async ({ tx, record }) => {
    const cidr = String(record["cidr"]);
    const gateway = record["gateway"] as string | null;
    if (gateway && !cidrContains(cidr, gateway))
      throw new ValidationError({ gateway: "Il gateway non appartiene alla rete" });
    const others = await tx.query<{ name: string; cidr: string }>(
      "SELECT name, cidr FROM networks WHERE deleted_at IS NULL AND id <> ?",
      [record.id],
    );
    const clash = others.find((o) => cidrOverlaps(o.cidr, cidr));
    if (clash) throw new ConflictError(`Si sovrappone alla rete ${clash.name} (${clash.cidr})`);
  },
};

const ipAddress: EntityDef = {
  key: "ip_address",
  module: "it",
  label: "Indirizzo IP",
  plural: "Indirizzi IP",
  table: "ip_addresses",
  title: (r) => String(r["address"]),
  defaultOrder: "address asc",
  fields: [
    { name: "network_id", label: "Rete", type: "ref", ref: "network", required: true, list: true },
    {
      name: "address",
      label: "Indirizzo",
      type: "ip",
      required: true,
      unique: ["network_id"],
      searchable: true,
      list: true,
    },
    {
      name: "kind",
      label: "Tipo",
      type: "select",
      options: IP_KINDS,
      required: true,
      default: "static",
      list: true,
    },
    { name: "hostname", label: "Nome host", type: "text", searchable: true, list: true },
    { name: "asset_id", label: "Asset", type: "ref", ref: "asset", list: true },
    { name: "notes", label: "Note", type: "text" },
  ],
  beforeSave: async ({ tx, record }) => {
    const [net] = await tx.query<{ cidr: string }>("SELECT cidr FROM networks WHERE id = ?", [
      record["network_id"] as string,
    ]);
    if (net && !cidrContains(net.cidr, String(record["address"]))) {
      throw new ValidationError({ address: `L'indirizzo non appartiene alla rete ${net.cidr}` });
    }
  },
};

const vpnPeer: EntityDef = {
  key: "vpn_peer",
  module: "it",
  label: "Peer WireGuard",
  plural: "VPN WireGuard",
  table: "vpn_peers",
  title: (r) => String(r["name"]),
  defaultOrder: "name asc",
  fields: [
    {
      name: "name",
      label: "Nome",
      type: "text",
      required: true,
      unique: true,
      searchable: true,
      list: true,
    },
    {
      name: "public_key",
      label: "Chiave pubblica",
      type: "text",
      required: true,
      unique: true,
      maxLength: 44,
      help: "Solo la chiave pubblica: la chiave privata resta sul dispositivo e non va mai inserita qui",
      validate: (v) =>
        WG_KEY.test(String(v))
          ? null
          : "Chiave pubblica WireGuard non valida (44 caratteri base64)",
    },
    {
      name: "allowed_ips",
      label: "IP consentiti",
      type: "text",
      required: true,
      list: true,
      help: "Reti CIDR separate da virgola, es. 10.8.0.2/32",
      validate: (v) =>
        String(v)
          .split(",")
          .map((s) => s.trim())
          .every((s) => isCidr(s))
          ? null
          : "Elenco di reti CIDR non valido",
    },
    {
      name: "endpoint",
      label: "Endpoint",
      type: "text",
      help: "host:porta, se il peer ha un indirizzo fisso",
    },
    { name: "owner_id", label: "Dipendente", type: "ref", ref: "employee", list: true },
    { name: "enabled", label: "Attivo", type: "boolean", default: true, list: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
};

const itAccount: EntityDef = {
  key: "it_account",
  module: "it",
  label: "Account",
  plural: "Account e accessi",
  table: "it_accounts",
  title: (r) => `${r["system"]} · ${r["username"]}`,
  defaultOrder: "system asc",
  fields: [
    {
      name: "system",
      label: "Sistema / servizio",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    {
      name: "username",
      label: "Utente",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "owner_id", label: "Titolare", type: "ref", ref: "employee", list: true },
    { name: "role", label: "Ruolo / privilegi", type: "text", list: true },
    {
      name: "mfa_enabled",
      label: "Autenticazione a due fattori",
      type: "boolean",
      default: false,
      list: true,
    },
    { name: "last_review", label: "Ultima verifica", type: "date" },
    {
      name: "notes",
      label: "Note",
      type: "longtext",
      help: "Non inserire password: questo registro elenca gli accessi, non li custodisce",
    },
  ],
};

const license: EntityDef = {
  key: "license",
  module: "it",
  label: "Licenza",
  plural: "Licenze software",
  table: "licenses",
  title: (r) => String(r["product"]),
  defaultOrder: "expires_on asc",
  fields: [
    {
      name: "product",
      label: "Prodotto",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "vendor", label: "Fornitore", type: "text", searchable: true },
    {
      name: "seats",
      label: "Postazioni acquistate",
      type: "integer",
      required: true,
      min: 1,
      default: 1,
      list: true,
    },
    {
      name: "used_seats",
      label: "Postazioni in uso",
      type: "integer",
      required: true,
      min: 0,
      default: 0,
      list: true,
    },
    { name: "expires_on", label: "Scadenza", type: "date", list: true },
    { name: "cost", label: "Costo annuo", type: "money", default: 0, min: 0 },
    {
      name: "key_location",
      label: "Dove è custodito il codice",
      type: "text",
      help: "Un riferimento (es. gestore password), non il codice",
    },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    if (Number(record["used_seats"]) > Number(record["seats"])) {
      throw new ValidationError({ used_seats: "Le postazioni in uso superano quelle acquistate" });
    }
  },
};

const backupJob: EntityDef = {
  key: "backup_job",
  module: "it",
  label: "Job di backup",
  plural: "Backup",
  table: "backup_jobs",
  title: (r) => String(r["name"]),
  defaultOrder: "name asc",
  fields: [
    {
      name: "name",
      label: "Nome",
      type: "text",
      required: true,
      unique: true,
      searchable: true,
      list: true,
    },
    { name: "asset_id", label: "Sistema protetto", type: "ref", ref: "asset", list: true },
    { name: "destination", label: "Destinazione", type: "text", list: true },
    {
      name: "expected_every_hours",
      label: "Frequenza attesa (ore)",
      type: "integer",
      required: true,
      min: 1,
      max: 8760,
      default: 24,
      list: true,
    },
    {
      name: "retention_days",
      label: "Conservazione (giorni)",
      type: "integer",
      min: 1,
      default: 30,
    },
    { name: "enabled", label: "Attivo", type: "boolean", default: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
};

const backupRun: EntityDef = {
  key: "backup_run",
  module: "it",
  label: "Esecuzione backup",
  plural: "Esecuzioni di backup",
  table: "backup_runs",
  title: (r) => String(r["finished_at"]),
  defaultOrder: "finished_at desc",
  fields: [
    { name: "job_id", label: "Job", type: "ref", ref: "backup_job", required: true, list: true },
    { name: "finished_at", label: "Terminato il", type: "datetime", required: true, list: true },
    {
      name: "status",
      label: "Esito",
      type: "select",
      options: RUN_STATUS,
      required: true,
      default: "success",
      list: true,
    },
    { name: "size_mb", label: "Dimensione (MB)", type: "decimal", min: 0, list: true },
    { name: "notes", label: "Note", type: "text" },
  ],
};

const securityEvent: EntityDef = {
  key: "security_event",
  module: "it",
  label: "Evento di sicurezza",
  plural: "Eventi di sicurezza",
  table: "security_events",
  title: (r) => String(r["summary"]),
  defaultOrder: "occurred_at desc",
  fields: [
    { name: "occurred_at", label: "Data e ora", type: "datetime", required: true, list: true },
    {
      name: "severity",
      label: "Gravità",
      type: "select",
      options: SEVERITY,
      required: true,
      default: "medium",
      list: true,
    },
    {
      name: "category",
      label: "Categoria",
      type: "select",
      options: EVENT_CATEGORIES,
      required: true,
      default: "other",
      list: true,
    },
    {
      name: "summary",
      label: "Sintesi",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "details", label: "Dettagli", type: "longtext", searchable: true },
    { name: "asset_id", label: "Asset coinvolto", type: "ref", ref: "asset" },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: EVENT_STATUS,
      required: true,
      default: "open",
      list: true,
    },
    { name: "resolution", label: "Risoluzione", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    if (record["status"] === "resolved" && !record["resolution"]) {
      throw new ValidationError({ resolution: "Descrivi come è stato risolto" });
    }
  },
};

const monitorCheck: EntityDef = {
  key: "monitor_check",
  module: "it",
  label: "Controllo",
  plural: "Controlli di raggiungibilità",
  table: "monitor_checks",
  title: (r) => `${r["name"]} (${r["host"]}:${r["port"]})`,
  defaultOrder: "name asc",
  fields: [
    { name: "name", label: "Nome", type: "text", required: true, unique: true, list: true },
    {
      name: "host",
      label: "Host o indirizzo IP",
      type: "text",
      required: true,
      list: true,
      maxLength: 253,
    },
    {
      name: "port",
      label: "Porta TCP",
      type: "integer",
      required: true,
      min: 1,
      max: 65535,
      list: true,
    },
    { name: "asset_id", label: "Asset", type: "ref", ref: "asset" },
    { name: "enabled", label: "Attivo", type: "boolean", default: true },
  ],
};

const techDoc: EntityDef = {
  key: "tech_doc",
  module: "it",
  label: "Documento tecnico",
  plural: "Documentazione tecnica",
  table: "tech_docs",
  title: (r) => String(r["title"]),
  defaultOrder: "title asc",
  fields: [
    { name: "title", label: "Titolo", type: "text", required: true, searchable: true, list: true },
    {
      name: "category",
      label: "Categoria",
      type: "select",
      options: DOC_CATEGORIES,
      required: true,
      default: "howto",
      list: true,
    },
    { name: "asset_id", label: "Asset collegato", type: "ref", ref: "asset" },
    {
      name: "body",
      label: "Contenuto",
      type: "longtext",
      required: true,
      searchable: true,
      maxLength: 100_000,
    },
  ],
};

export const IT_ENTITIES: EntityDef[] = [
  asset,
  network,
  ipAddress,
  vpnPeer,
  itAccount,
  license,
  backupJob,
  backupRun,
  securityEvent,
  monitorCheck,
  techDoc,
];
