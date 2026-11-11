# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni secondo
[Semantic Versioning](https://semver.org/lang/it/).

## [Unreleased]

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
- Stack Docker Compose: PostgreSQL 16, Redis 7, backend, proxy HTTPS Caddy legato all'indirizzo VPN.
- CI GitHub Actions: lint, type-check, test unitari e di integrazione, audit delle dipendenze,
  validazione Compose e build dell'immagine.
- Configurazione Dependabot.
- Documentazione tecnica iniziale.
