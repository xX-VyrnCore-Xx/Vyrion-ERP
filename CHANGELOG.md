# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni secondo
[Semantic Versioning](https://semver.org/lang/it/).

## [Unreleased]

Milestone 3 (database e backend).

### Added

- Modelli e migrazione `0002`: azienda, utenti, ruoli, permessi, assegnazioni, audit log.
- Vincoli nel database: azienda unica, forfettario solo per ditta individuale, email utente
  univoca tra gli attivi, audit log solo in aggiunta.
- Concorrenza ottimistica (`version`), soft delete, UUID v7, paginazione a cursore.
- Errori con formato uniforme `{"error": {"code", "message", "details"}}`.
- Catalogo permessi e ruoli di sistema; comando `python -m app.cli bootstrap`, eseguito
  all'avvio del container.
- Validazione di partita IVA e struttura del codice fiscale.

### Changed

- Aggiornamenti delle dipendenze: Python 3.15, PostgreSQL 18, Redis 8 (immagini Docker e servizi
  di CI); `actions/checkout` 7, `actions/setup-node` 7, `pnpm/action-setup` 6,
  `astral-sh/setup-uv` 7.
- Il volume di PostgreSQL è montato su `/var/lib/postgresql`, come richiesto dalle immagini 18+.
  Un'installazione esistente con dati PostgreSQL 16 richiede `pg_upgrade` o dump e ripristino.

## [0.1.0-alpha.1] - 2026-11-11

Milestone 1 (architettura e repository) e 2 (configurazione dell'ambiente).

### Added

- Struttura monorepo: `apps/desktop`, `backend`, `infra`, `docs`.
- Backend FastAPI con configurazione da variabili d'ambiente e nessun segreto predefinito.
- Endpoint `GET /api/v1/health/live` e `GET /api/v1/health/ready` con verifica reale di PostgreSQL
  e Redis.
- SQLAlchemy 2 asincrono e Alembic con migrazione baseline.
- Applicazione desktop Tauri 2 + React + TypeScript + Tailwind: configurazione dell'indirizzo del
  server, stato della connessione con retry esponenziale e riconnessione automatica, tema scuro e
  chiaro, informazioni sulla piattaforma.
- Stack Docker Compose: PostgreSQL, Redis, backend, proxy HTTPS Caddy legato all'indirizzo VPN.
- CI GitHub Actions: lint, type-check, test unitari e di integrazione, audit delle dipendenze,
  validazione Compose e build dell'immagine.
- Configurazione Dependabot.
- Documentazione tecnica iniziale.
