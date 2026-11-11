# Architettura

## Vista d'insieme

```
┌──────────────── Postazione (Windows / macOS) ────────────────┐
│  Vyrion ERP (Tauri 2)                                        │
│  ┌──────────────────────┐   ┌─────────────────────────────┐  │
│  │ Interfaccia React    │◄─►│ Core Rust                   │  │
│  │ (webview di sistema) │IPC│ SQLite locale · coda sync * │  │
│  └──────────────────────┘   └─────────────────────────────┘  │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTPS dentro il tunnel WireGuard
┌───────────────────────────────▼──────────────────────────────┐
│  Server Ubuntu (VM Proxmox VE) — Docker Compose              │
│  proxy HTTPS ─► backend FastAPI ─► PostgreSQL                │
│  (solo IP VPN)        │      └────► Redis                    │
│                       └─► servizi sync / backup / documenti *│
└───────────────────────────────┬──────────────────────────────┘
                                │
                         NAS: documenti, allegati, copie di backup *
```

`*` = previsto, non ancora implementato.

## Principi

1. **Il backend è l'unica autorità.** Autenticazione, autorizzazioni e regole di business vengono
   sempre verificate lato server. L'interfaccia nasconde ciò che non è permesso solo per comodità.
2. **Offline-first.** L'app si apre sempre. Senza server usa i dati locali e accoda le modifiche.
3. **Nessuna esposizione a Internet.** Il proxy ascolta solo sull'indirizzo dell'interfaccia WireGuard.
4. **Modularità.** Ogni modulo (ERP, CRM, IT) è un pacchetto con modelli, schemi, servizi e router
   propri; i moduli comunicano tramite servizi, non accedendo alle tabelle altrui.
5. **Niente finzione.** Nessun dato fittizio presentato come reale, nessun pulsante senza funzione.

## Componenti attuali

### Backend (`backend/`)

| Percorso | Ruolo |
| --- | --- |
| `app/main.py` | Factory `create_app`: ciclo di vita, CORS, router |
| `app/core/config.py` | Impostazioni da ambiente (`VYRION_*`), senza default per i segreti |
| `app/db/` | Base dichiarativa con naming convention, engine e sessioni asincrone |
| `app/api/v1/` | Router versionati; oggi `health` |
| `migrations/` | Alembic |

Engine SQLAlchemy e client Redis sono creati nel `lifespan` e conservati in `app.state`: nessuno
stato globale, quindi i test istanziano applicazioni indipendenti.

### Desktop (`apps/desktop/`)

| Percorso | Ruolo |
| --- | --- |
| `src/lib/serverUrl.ts` | Validazione dell'indirizzo server (HTTPS obbligatorio, HTTP solo loopback) |
| `src/lib/health.ts` | Probe di raggiungibilità con timeout e validazione della risposta |
| `src/lib/backoff.ts` | Intervalli di polling e backoff esponenziale |
| `src/hooks/useServerStatus.ts` | Stato connessione, retry, riconnessione su eventi di rete |
| `src/i18n/it.ts` | Testi dell'interfaccia (italiano; struttura pronta per altre lingue) |
| `src-tauri/` | Shell Rust, CSP, capability minime |

### Stato della connessione

```
unconfigured ──(indirizzo salvato)──► checking ──► online ◄──► degraded
                                          │           ▲            ▲
                                          ▼           │            │
                                       offline ───────┴────────────┘
                                  (retry 2s → 30s, evento "online", focus finestra)
```

- **online**: il server e le sue dipendenze rispondono.
- **degraded**: il server risponde ma PostgreSQL o Redis no (HTTP 503).
- **offline**: nessuna risposta valida. Una risposta che non rispetta il contratto (es. captive
  portal) è trattata come offline, mai come server raggiungibile.

Il client **non dipende dal tipo di VPN**: verifica la raggiungibilità HTTPS del backend. WireGuard
è gestito dal sistema operativo.

## Accesso e autorizzazione

```
client ──POST /auth/login──► limite per indirizzo ─► blocco account? ─► verifica Argon2id
                                                                          │
                          ┌──────────── 2FA attivo? ◄─────────────────────┘
                          ▼ sì                                  no ▼
              sfida (5 min, 5 tentativi)                     apre la sessione
                          │ TOTP o codice di recupero               │
                          └────────────────────────────────────────►│
                                                                    ▼
                               access token (15 min) + refresh token (rotante)

richiesta ──► Bearer ──► sessione valida e non revocata? ──► utente attivo? ──► permessi da ruoli
                                                                               + concessioni dirette
                                                                                       │
                                            require("modulo.risorsa:azione") ◄─────────┘
```

- **Token opachi con stato nel database**, non JWT: una revoca o una disattivazione hanno effetto
  alla richiesta successiva, senza aspettare una scadenza. Il costo è una lettura per richiesta.
- **Le sessioni si aprono solo in `AuthService`**; le rotte non toccano mai password o token.
- **Un errore non cancella i suoi effetti di sicurezza:** i tentativi falliti vengono confermati
  nel database prima di restituire l'errore, altrimenti il rollback cancellerebbe il contatore.
- **Un livello di servizi** (`app/services`) applica le regole; le rotte (`app/api/v1`) validano,
  chiamano il servizio e confermano la transazione.

## Decisioni rilevanti

| Decisione | Motivo |
| --- | --- |
| `psycopg` 3 come driver unico | Stesso URL per applicazione asincrona e Alembic sincrono |
| Factory `create_app(settings)` | Test isolati, nessun import con effetti collaterali |
| Proxy Caddy davanti al backend | TLS, intestazioni di sicurezza, backend non esposto direttamente |
| Tailwind 4 con variabili CSS | Un solo set di token per tema scuro e chiaro |
| Chiamate di rete dal webview (per ora) | Sufficiente per la probe; dalla M5 le chiamate autenticate passano dal lato Rust |
