# Architettura

## Vista d'insieme

Vyrion ERP è un'applicazione **offline-first**: il programma desktop è il prodotto principale e
funziona da solo, con i dati su questo computer. Il server aziendale è **facoltativo** e si
collega in un secondo momento.

```
┌──────────────── Postazione (Windows / macOS Apple Silicon) ───────────────┐
│  Vyrion ERP (Tauri 2)                                                     │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐     │
│  │ Interfaccia React            │    │ Guscio Rust                  │     │
│  │ moduli CRM / ERP / IT        │◄──►│ SQLite + SQLCipher (cifrato) │     │
│  │ regole di business (TS)      │IPC │ chiave nel portachiavi del   │     │
│  │ livello dati · audit · outbox│    │ sistema · backup · allegati  │     │
│  └──────────────────────────────┘    └──────────────────────────────┘     │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  │ (facoltativo, in un secondo momento)
                                  │ HTTPS dentro il tunnel WireGuard
┌─────────────────────────────────▼─────────────────────────────────────────┐
│  Server Ubuntu (VM Proxmox VE) — Docker Compose                           │
│  proxy HTTPS ─► backend FastAPI ─► PostgreSQL        (già realizzato:     │
│                       └────► Redis                    accesso, RBAC,      │
│                                                       audit)              │
│                       └─► sincronizzazione / backup centrale *            │
└───────────────────────────────────────────────────────────────────────────┘
```

`*` = previsto, non ancora implementato.

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

### Dati locali (`apps/desktop/src/data`, `src-tauri`)

| Percorso | Ruolo |
| --- | --- |
| `src-tauri/src/db.rs`, `manager.rs`, `keystore.rs` | SQLite con SQLCipher; chiave a 256 bit nel portachiavi (Credential Manager / Keychain); *authorizer* che vieta `ATTACH`, estensioni e cambi di chiave dal webview; backup cifrati con password e ripristino atomico |
| `src-tauri/src/files.rs`, `system.rs` | Allegati per hash del contenuto con verifica di manomissione; risorse del computer; prova TCP |
| `src/data/db.ts`, `nativeDriver.ts`, `memoryDriver.ts` | Un'unica interfaccia `Database` con due driver: nativo (Tauri) e SQLite in memoria (test e sviluppo nel browser, escluso dalla build di produzione) |
| `src/data/entity.ts`, `registry.ts`, `repository.ts` | Ogni entità è una definizione dichiarativa: da essa derivano tabella, validazione, repository, audit e coda di sincronizzazione |
| `src/data/system.ts`, `workspace.ts`, `migrations.ts` | Impostazioni, audit *append-only* (trigger), outbox, migrazioni con checksum |
| `src/modules/*` | Definizioni e regole dei moduli CRM, ERP e IT, report, notifiche, ricerca |

Ogni scrittura è **una transazione** che comprende la modifica, la riga di audit e, se il server è
collegato, l'operazione in outbox. Importi in **centesimi interi**; identificativi **UUID v7**
generati dal client; versione per record (blocco ottimistico); eliminazione logica.

### Desktop (`apps/desktop/`)

| Percorso | Ruolo |
| --- | --- |
| `src/App.tsx`, `src/app/` | Avvio (apre il database locale), router a hash, contesto dell'area di lavoro |
| `src/pages/`, `src/ui/` | Schermate generiche (elenco, scheda, storico, allegati) e dedicate (documenti, prima nota, pipeline, agenda, magazzino, report, controlli di rete, impostazioni) |
| `src/lib/serverUrl.ts` | Validazione dell'indirizzo server (HTTPS obbligatorio, HTTP solo loopback) |
| `src/lib/health.ts` | Probe di raggiungibilità con timeout e validazione della risposta |
| `src/lib/backoff.ts` | Intervalli di polling e backoff esponenziale |
| `src/hooks/useServerStatus.ts` | Stato connessione, retry, riconnessione su eventi di rete |
| `src/i18n/it.ts` | Testi dell'interfaccia (italiano; struttura pronta per altre lingue) |
| `src-tauri/` | Shell Rust, CSP, capability minime |

### Stato della connessione (collegamento facoltativo)

```
unconfigured (solo locale) ──(indirizzo salvato)──► checking ──► online ◄──► degraded
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
