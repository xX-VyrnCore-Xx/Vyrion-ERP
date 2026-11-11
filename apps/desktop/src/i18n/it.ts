/** Italian UI strings. Other locales implement the same shape. */
export const it = {
  appName: "Vyrion ERP",
  nav: { label: "Navigazione principale", status: "Stato del sistema", settings: "Impostazioni" },
  connection: {
    unconfigured: "Solo locale (nessun server)",
    checking: "Verifica in corso",
    online: "Connesso",
    degraded: "Server degradato",
    offline: "Non raggiungibile",
  },
  status: {
    title: "Stato del sistema",
    subtitle: "Raggiungibilità del server aziendale attraverso la VPN.",
    server: "Server",
    serverVersion: "Versione server",
    lastCheck: "Ultima verifica",
    never: "mai",
    retry: "Verifica ora",
    components: "Componenti",
    database: "Database PostgreSQL",
    redis: "Redis",
    componentOk: "Operativo",
    componentError: "Errore",
    latency: (ms: number) => `${ms} ms`,
    unconfiguredHint: "Imposta l'indirizzo del server nelle Impostazioni per avviare la verifica.",
    offlineHint:
      "Il server non risponde. Controlla che la VPN WireGuard sia attiva: l'app riproverà automaticamente.",
    noComponentData: "Dati disponibili solo quando il server risponde.",
    openSettings: "Apri impostazioni",
  },
  settings: {
    title: "Impostazioni",
    subtitle: "Configurazione locale di questa installazione.",
    serverSection: "Server aziendale (facoltativo)",
    serverIntro:
      "Vyrion ERP funziona da solo, con i dati su questo computer. Il collegamento a un server aziendale è facoltativo e si può attivare in qualsiasi momento: i dati esistenti verranno poi sincronizzati con esso.",
    serverStatusLink: "Stato del server",
    serverUrl: "Indirizzo del server",
    serverUrlHelp:
      "URL HTTPS del backend raggiungibile via VPN, ad esempio https://erp.vyrncore.lan",
    save: "Salva",
    saved: "Indirizzo salvato.",
    remove: "Rimuovi",
    appearance: "Aspetto",
    theme: "Tema",
    themeDark: "Scuro",
    themeLight: "Chiaro",
    about: "Informazioni",
    appVersion: "Versione applicazione",
    platform: "Piattaforma",
    browserRuntime: "Browser (modalità sviluppo)",
  },
  errors: {
    urlEmpty: "Inserisci l'indirizzo del server.",
    urlInvalid: "L'indirizzo non è un URL valido.",
    urlInsecure: "È richiesto HTTPS. HTTP è ammesso solo per localhost in sviluppo.",
    urlCredentials: "L'indirizzo non deve contenere credenziali.",
  },
} as const;

export type Messages = typeof it;
export const t: Messages = it;
