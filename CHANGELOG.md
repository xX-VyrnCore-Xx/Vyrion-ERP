# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni secondo
[Semantic Versioning](https://semver.org/lang/it/).

## [Unreleased]

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
