import {
  BookOpen,
  Boxes,
  Briefcase,
  CalendarDays,
  ClipboardList,
  FileText,
  Gauge,
  Handshake,
  Kanban,
  Landmark,
  LayoutDashboard,
  Network,
  Package,
  Radar,
  ScrollText,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

/** A sub-menu entry under a menu item. */
export interface NavChild {
  label: string;
  /** Hash path without "#/", optionally with a query ("documents?type=quote"). */
  to: string;
  /** Other routes that also highlight this entry. */
  match?: string[];
  /** Highlighted when the query key is missing (the page's default tab). */
  fallback?: boolean;
}
export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Hash path without "#/". */
  to: string;
  /** Routes that also highlight this item. */
  match?: string[];
  /** Sub-menu: the item opens it, the chevron toggles it. */
  children?: NavChild[];
}
export interface NavSection {
  title: string | null;
  items: NavItem[];
}

const e = (key: string) => `e/${key}`;

export const NAV: NavSection[] = [
  { title: null, items: [{ label: "Panoramica", icon: LayoutDashboard, to: "" }] },
  {
    title: "CRM",
    items: [
      {
        label: "Anagrafiche",
        icon: Users,
        to: e("party"),
        children: [
          { label: "Clienti e fornitori", to: e("party") },
          { label: "Contatti", to: e("contact") },
          { label: "Duplicati", to: "duplicates" },
        ],
      },
      {
        label: "Pipeline",
        icon: Kanban,
        to: "pipeline",
        children: [
          { label: "Per fase", to: "pipeline" },
          { label: "Elenco opportunità", to: e("opportunity") },
          { label: "Fasi", to: e("pipeline_stage") },
        ],
      },
      { label: "Comunicazioni", icon: Handshake, to: e("communication") },
      {
        label: "Agenda",
        icon: CalendarDays,
        to: "calendar",
        children: [
          { label: "Calendario", to: "calendar" },
          { label: "Appuntamenti", to: e("appointment") },
        ],
      },
      { label: "Attività", icon: ClipboardList, to: e("task") },
      { label: "Contratti", icon: ScrollText, to: e("contract") },
      {
        label: "Assistenza",
        icon: Briefcase,
        to: e("ticket"),
        children: [
          { label: "Ticket", to: e("ticket") },
          { label: "Interventi", to: e("ticket_intervention") },
          { label: "Ore da fatturare", to: "billing-hours" },
        ],
      },
    ],
  },
  {
    title: "ERP",
    items: [
      {
        label: "Documenti",
        icon: FileText,
        to: "documents",
        match: ["d/"],
        children: [
          { label: "Fatture", to: "documents?type=invoice", fallback: true },
          { label: "Preventivi", to: "documents?type=quote" },
          { label: "Ordini", to: "documents?type=order" },
          { label: "Note di credito", to: "documents?type=credit_note" },
          { label: "Acquisti", to: "documents?type=purchase_invoice" },
        ],
      },
      {
        label: "Scadenzario",
        icon: Landmark,
        to: "deadlines",
        children: [
          { label: "Scadenze", to: "deadlines" },
          { label: "Pagamenti", to: e("payment") },
          { label: "Riconciliazione bancaria", to: "reconciliation" },
        ],
      },
      {
        label: "Prima nota",
        icon: BookOpen,
        to: "journal",
        children: [
          { label: "Registrazioni", to: "journal" },
          { label: "Piano dei conti", to: e("account") },
          { label: "Cespiti e ammortamenti", to: "fixed-assets" },
          { label: "Adeguamento cambi", to: "fx-revaluation" },
          { label: "Chiusura esercizio", to: "closing" },
        ],
      },
      {
        label: "Prodotti e magazzino",
        icon: Package,
        to: "inventory",
        children: [
          { label: "Giacenze", to: "inventory" },
          { label: "Prodotti", to: e("product") },
          { label: "Movimenti", to: e("stock_movement") },
          { label: "Magazzini", to: e("warehouse") },
          { label: "Lotti", to: e("stock_lot") },
        ],
      },
      {
        label: "Personale",
        icon: Users,
        to: e("employee"),
        children: [
          { label: "Dipendenti", to: e("employee") },
          { label: "Assenze", to: e("leave") },
          { label: "Presenze e buste paga", to: "payroll" },
          { label: "Registro presenze", to: e("attendance") },
        ],
      },
      {
        label: "Progetti e ore",
        icon: Gauge,
        to: e("project"),
        children: [
          { label: "Progetti", to: e("project") },
          { label: "Ore", to: e("time_entry") },
        ],
      },
      {
        label: "Report",
        icon: Boxes,
        to: "reports",
        children: [
          { label: "Report del periodo", to: "reports" },
          { label: "Registri IVA e liquidazione", to: "vat" },
          { label: "Esportazione per il commercialista", to: "accountant-export" },
        ],
      },
    ],
  },
  {
    title: "IT",
    items: [
      { label: "Inventario", icon: Package, to: e("asset") },
      {
        label: "Reti e IP",
        icon: Network,
        to: e("network"),
        children: [
          { label: "Reti", to: e("network") },
          { label: "Indirizzi IP", to: e("ip_address") },
        ],
      },
      { label: "VPN WireGuard", icon: Network, to: e("vpn_peer") },
      {
        label: "Account e licenze",
        icon: Users,
        to: e("it_account"),
        children: [
          { label: "Account", to: e("it_account") },
          { label: "Licenze", to: e("license") },
        ],
      },
      {
        label: "Backup",
        icon: Boxes,
        to: e("backup_job"),
        children: [
          { label: "Lavori", to: e("backup_job") },
          { label: "Esecuzioni", to: e("backup_run") },
        ],
      },
      { label: "Sicurezza", icon: ShieldAlert, to: e("security_event") },
      {
        label: "Controlli di rete",
        icon: Radar,
        to: "monitor",
        children: [
          { label: "Stato", to: "monitor" },
          { label: "Controlli", to: e("monitor_check") },
        ],
      },
      { label: "Documentazione", icon: BookOpen, to: e("tech_doc") },
    ],
  },
];

/** Where the person is: the hash path and its query. */
export interface Place {
  path: string;
  query: URLSearchParams;
}

const under = (path: string, base: string): boolean =>
  path === base || path.startsWith(base.endsWith("/") ? base : `${base}/`);

/** True when `to` (a route, maybe with a query) is the current place. */
export function isHere(to: string, place: Place, extra: string[] = [], fallback = false): boolean {
  const [base = "", queryText = ""] = to.split("?");
  const onBase = base === "" ? place.path === "" : under(place.path, base);
  const onExtra = extra.some((m) => under(place.path, m));
  if (!onBase && !onExtra) return false;
  if (!queryText) return true;
  for (const [key, value] of new URLSearchParams(queryText)) {
    const current = place.query.get(key);
    if (current !== value && !(fallback && current === null)) return false;
  }
  return true;
}

/** An item is "inside" when it, one of its extra routes or one of its sub-entries is current. */
export function itemIsHere(item: NavItem, place: Place): boolean {
  return (
    isHere(item.to.split("?")[0] ?? "", place, item.match) ||
    (item.children ?? []).some((c) => isHere(c.to, place, c.match, c.fallback))
  );
}
