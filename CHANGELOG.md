# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni secondo
[Semantic Versioning](https://semver.org/lang/it/).

## [Unreleased]

Milestone 4 (autenticazione e autorizzazioni).

### Added

- Accesso con Argon2id; token opachi di sessione (accesso 15 minuti, rinnovo 14 giorni, durata
  massima 30 giorni) con rotazione del refresh token e rilevamento del riuso.
- 2FA TOTP con 10 codici di recupero monouso, seme cifrato nel database, anti-riuso dei codici.
- Protezione dalla forza bruta: blocco dell'account, limite per indirizzo e sull'intera API.
- RBAC applicato dal backend su ogni rotta, con concessioni dirette ai singoli utenti e regole
  anti-escalation dei privilegi.
- API di autenticazione, utenti, ruoli, azienda e registro di audit (vedi `docs/API.md`).
- Disconnessione da tutti i dispositivi, propria o di un utente; elenco e revoca dei dispositivi.
- Token monouso per scegliere o reimpostare la password: nessuna password temporanea.
- Storico degli accessi immutabile; identificativo di richiesta (`X-Request-ID`) nell'audit.
- Migrazione `0003`; comandi `python -m app.cli create-admin` e `generate-key`; pulizia
  automatica di sessioni e token scaduti in `bootstrap`.
- Chiave di cifratura (`ENCRYPTION_KEYS`) nella configurazione di Compose.

### Changed

- Migrazioni e `bootstrap` richiedono solo l'URL del database, non i segreti applicativi.
- Il backend non parte senza almeno una chiave di cifratura valida.
- Dietro il proxy il backend si fida delle intestazioni `X-Forwarded-*` (rete interna di Docker),
  così limiti e audit vedono l'indirizzo reale del client.
- La politica delle password rifiuta qualsiasi password che contenga l'indirizzo email intero.

## [0.1.0-alpha.1] - 2026-11-11

Primo rilascio: fondamenta del progetto (milestone 1, 2 e 3) e pipeline di rilascio.

**Anteprima tecnica.** Contiene l'infrastruttura, il guscio dell'applicazione desktop e il modello
dati di base. **I moduli ERP, CRM e IT, l'autenticazione e la sincronizzazione offline non sono
ancora implementati.** Gli installer non sono firmati.

### Added

- Struttura monorepo: `apps/desktop`, `backend`, `infra`, `docs`, `tools`.
- Backend FastAPI (Python 3.15) con configurazione da variabili d'ambiente e nessun segreto
  predefinito; `GET /api/v1/health/live` e `GET /api/v1/health/ready` con verifica reale di
  PostgreSQL e Redis.
- Applicazione desktop Tauri 2 + React + TypeScript + Tailwind: configurazione dell'indirizzo del
  server, stato della connessione con retry esponenziale e riconnessione automatica, tema scuro e
  chiaro, informazioni sulla piattaforma.
- Stack Docker Compose: PostgreSQL 18, Redis 8, backend e proxy HTTPS Caddy legato all'indirizzo
  VPN.
- Modello dati di base (migrazione `0002`): azienda, utenti, ruoli, permessi, assegnazioni e audit
  log, con vincoli nel database: azienda unica, forfettario solo per ditta individuale, email
  utente univoca tra gli attivi, audit log solo in aggiunta.
- Concorrenza ottimistica (`version`), cancellazione logica, UUID v7, paginazione a cursore ed
  errori con formato uniforme `{"error": {"code", "message", "details"}}`.
- Catalogo dei permessi e ruoli di sistema, sincronizzati dal comando `python -m app.cli bootstrap`
  all'avvio del container; validazione di partita IVA e struttura del codice fiscale.
- CI GitHub Actions: lint, type-check, test unitari e di integrazione su PostgreSQL e Redis reali,
  audit delle dipendenze, validazione Compose, build dell'immagine, test degli strumenti di
  rilascio. Configurazione Dependabot.
- Pipeline di rilascio su tag: verifica che tag e versioni coincidano, installer per Windows x64
  (NSIS) e macOS Apple Silicon e Intel (DMG), checksum SHA-256, release su GitHub con alpha, beta e
  rc come pre-release.
- Pulizia automatica: dopo ogni release restano le ultime 3, in ordine di precedenza semantica;
  eseguibile anche a mano in modalità di anteprima.
- Firma e notarizzazione macOS opzionali, attive solo se i segreti sono configurati.
- Documentazione tecnica.

### Note

- Windows: l'installer non è firmato e il sistema mostrerà l'avviso "editore sconosciuto".
- Non viene prodotto l'MSI: non accetta versioni con pre-release `alpha.N`.
- Gli aggiornamenti automatici non sono ancora disponibili.

[Unreleased]: https://github.com/xX-VyrnCore-Xx/Vyrion-ERP/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/xX-VyrnCore-Xx/Vyrion-ERP/releases/tag/v0.1.0-alpha.1
