# Vyrion ERP

Piattaforma gestionale proprietaria di **VyrnCore Enterprises**: ERP, CRM e IT Management in
un'unica applicazione desktop (Windows e macOS) collegata al server aziendale tramite VPN privata.

> **Stato: `0.1.0-alpha.1` — milestone 1 e 2 completate** (architettura, repository, ambiente).
> I moduli gestionali non sono ancora implementati: vedi [docs/PLAN.md](docs/PLAN.md).

## Cosa funziona oggi

| Area | Implementato |
| --- | --- |
| Backend | FastAPI con probe `live` / `ready` che verificano realmente PostgreSQL e Redis |
| Database | SQLAlchemy 2 + Alembic con catena di migrazioni avviata (baseline) |
| Desktop | Shell Tauri 2 + React: stato della connessione al server, riconnessione automatica, tema scuro/chiaro |
| Server | Docker Compose: PostgreSQL, Redis, backend, proxy HTTPS esposto solo sull'interfaccia VPN |
| CI | Lint, type-check, test unitari e di integrazione, audit dipendenze, build immagine |

## Struttura

```
apps/desktop/        Applicazione desktop (React + TypeScript + Vite + Tailwind)
apps/desktop/src-tauri/  Shell nativa Tauri 2 (Rust)
backend/             API FastAPI, modelli SQLAlchemy, migrazioni Alembic
infra/               Docker Compose e proxy HTTPS del server aziendale
docs/                Documentazione tecnica
.github/             CI e aggiornamento dipendenze
```

## Avvio rapido (sviluppo)

Prerequisiti: Python 3.15 con [uv](https://docs.astral.sh/uv/), Node 22 con pnpm 10, Rust stabile,
PostgreSQL 18 e Redis 8 (locali o via Docker).

Backend:

```bash
cd backend
uv sync
export VYRION_DATABASE_URL=postgresql+psycopg://vyrion:<password>@127.0.0.1:5432/vyrion
export VYRION_REDIS_URL=redis://127.0.0.1:6379/0
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory --reload
```

Desktop:

```bash
cd apps/desktop
pnpm install
pnpm tauri dev      # applicazione nativa
pnpm dev            # solo interfaccia, nel browser su http://localhost:1420
```

In **Impostazioni** inserisci l'indirizzo del server (`http://127.0.0.1:8000` in sviluppo).

## Verifiche

```bash
cd backend && uv run ruff check . && uv run mypy && uv run pytest
cd apps/desktop && pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

I test di integrazione del backend si attivano quando `VYRION_DATABASE_URL` e `VYRION_REDIS_URL`
puntano a servizi reali; altrimenti vengono saltati.

## Documentazione

| Documento | Contenuto |
| --- | --- |
| [PLAN](docs/PLAN.md) | Milestone, stato, criteri di completamento |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Componenti e flussi |
| [TECH_STACK](docs/TECH_STACK.md) | Tecnologie e versioni |
| [DATABASE](docs/DATABASE.md) | Convenzioni dello schema e migrazioni |
| [SECURITY](SECURITY.md) | Modello di sicurezza |
| [MODULES](docs/MODULES.md) | Moduli ERP, CRM, IT |
| [API](docs/API.md) | Endpoint e convenzioni REST |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Installazione sul server aziendale |
| [BACKUP](docs/BACKUP.md) | Strategia di backup e ripristino |
| [SYNC_ENGINE](docs/SYNC_ENGINE.md) | Offline-first e sincronizzazione |
| [ROADMAP](docs/ROADMAP.md) | Versioni previste |
| [CONTRIBUTING](CONTRIBUTING.md) | Regole di sviluppo |
| [CHANGELOG](CHANGELOG.md) | Storico delle modifiche |

## Licenza

Software proprietario di VyrnCore Enterprises, a uso esclusivamente interno. Tutti i diritti riservati.
