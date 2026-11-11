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
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Hash path without "#/". */
  to: string;
  /** Routes that also highlight this item. */
  match?: string[];
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
      { label: "Anagrafiche", icon: Users, to: e("party"), match: [e("contact")] },
      {
        label: "Pipeline",
        icon: Kanban,
        to: "pipeline",
        match: [e("opportunity"), e("pipeline_stage")],
      },
      { label: "Comunicazioni", icon: Handshake, to: e("communication") },
      { label: "Agenda", icon: CalendarDays, to: "calendar", match: [e("appointment")] },
      { label: "Attività", icon: ClipboardList, to: e("task") },
      { label: "Contratti", icon: ScrollText, to: e("contract") },
      { label: "Assistenza", icon: Briefcase, to: e("ticket"), match: [e("ticket_intervention")] },
    ],
  },
  {
    title: "ERP",
    items: [
      { label: "Documenti", icon: FileText, to: "documents", match: ["d/"] },
      { label: "Scadenzario", icon: Landmark, to: "deadlines", match: [e("payment")] },
      { label: "Prima nota", icon: BookOpen, to: "journal", match: [e("account")] },
      {
        label: "Prodotti e magazzino",
        icon: Package,
        to: "inventory",
        match: [e("product"), e("stock_movement")],
      },
      { label: "Personale", icon: Users, to: e("employee"), match: [e("leave")] },
      { label: "Progetti e ore", icon: Gauge, to: e("project"), match: [e("time_entry")] },
      { label: "Report", icon: Boxes, to: "reports" },
    ],
  },
  {
    title: "IT",
    items: [
      { label: "Inventario", icon: Package, to: e("asset") },
      { label: "Reti e IP", icon: Network, to: e("network"), match: [e("ip_address")] },
      { label: "VPN WireGuard", icon: Network, to: e("vpn_peer") },
      { label: "Account e licenze", icon: Users, to: e("it_account"), match: [e("license")] },
      { label: "Backup", icon: Boxes, to: e("backup_job"), match: [e("backup_run")] },
      { label: "Sicurezza", icon: ShieldAlert, to: e("security_event") },
      { label: "Controlli di rete", icon: Radar, to: "monitor", match: [e("monitor_check")] },
      { label: "Documentazione", icon: BookOpen, to: e("tech_doc") },
    ],
  },
  {
    title: null,
    items: [{ label: "Impostazioni", icon: Settings, to: "settings", match: ["server"] }],
  },
];
