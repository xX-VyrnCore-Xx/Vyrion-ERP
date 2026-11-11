# Vyrion ERP

Piattaforma gestionale proprietaria di **VyrnCore Enterprises**: ERP, CRM e IT Management in
un'unica applicazione desktop (Windows 10/11 e macOS Apple Silicon). **Funziona da sola, offline,
con i dati cifrati su questo computer**; il collegamento al server aziendale (tramite VPN) è
facoltativo e si attiva in un secondo momento.

> **Stato: alpha.** L'app desktop contiene una prima implementazione reale dei moduli CRM, ERP e IT
> (vedi [docs/MODULES.md](docs/MODULES.md) per cosa c'è e cosa manca). La sincronizzazione con il
> server **non è ancora implementata**. L'interfaccia nativa non è ancora stata provata su una
> finestra Windows/macOS reale: vedi *Verifiche* nel [CHANGELOG](CHANGELOG.md).

## Cosa funziona oggi

| Area | Implementato |
| --- | --- |
| Backend | FastAPI: accesso con Argon2id e 2FA, sessioni revocabili, RBAC applicato dal server, utenti, ruoli, azienda, audit; probe `live` / `ready` reali |
| Database | SQLAlchemy 2 + Alembic: azienda, utenti, ruoli, permessi, sessioni, audit e storico accessi immutabili |
| Desktop | Tauri 2 + React, offline-first: database SQLite cifrato (SQLCipher), moduli CRM/ERP/IT, panoramica, notifiche, ricerca, backup e ripristino cifrati, collegamento facoltativo al server |
| Server | Docker Compose: PostgreSQL, Redis, backend, proxy HTTPS esposto solo sull'interfaccia VPN |
| CI | Lint, type-check, test unitari e di integrazione, audit dipendenze, build immagine |

## Struttura

```
apps/desktop/        Applicazione desktop (React + TypeScript + Vite + Tailwind)
apps/desktop/src-tauri/  Shell nativa Tauri 2 (Rust)
backend/             API FastAPI, modelli SQLAlchemy, migrazioni Alembic
infra/               Docker Compose e proxy HTTPS del server aziendale
docs/                Documentazione tecnica
tools/release/       Versionamento, pulizia delle release e relativi test
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
export VYRION_ENCRYPTION_KEYS=$(uv run python -m app.cli generate-key)   # solo per lo sviluppo
uv run alembic upgrade head
uv run python -m app.cli bootstrap                                    # permessi e ruoli di sistema
uv run python -m app.cli create-admin --email tu@esempio.it --name "Nome Cognome"
uv run uvicorn app.main:create_app --factory --reload
```

Desktop:

```bash
cd apps/desktop
pnpm install
pnpm tauri dev      # applicazione nativa
pnpm dev            # solo interfaccia, nel browser su http://localhost:1420
```

Alla prima apertura l'app chiede i dati dell'azienda (forma giuridica e regime fiscale sono due
scelte indipendenti) e parte subito: **non serve alcun server**. Nel solo browser (`pnpm dev`) i
dati sono in memoria e si perdono alla chiusura; con `pnpm tauri dev` sono nel database cifrato.

Il collegamento al server è facoltativo: in **Impostazioni** si può inserire l'indirizzo
(`http://127.0.0.1:8000` in sviluppo) per verificarne la raggiungibilità.

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
| [RELEASING](docs/RELEASING.md) | Build, release e pulizia automatica |
| [ROADMAP](docs/ROADMAP.md) | Versioni previste |
| [CONTRIBUTING](CONTRIBUTING.md) | Regole di sviluppo |
| [CHANGELOG](CHANGELOG.md) | Storico delle modifiche |

## Licenza

Software proprietario di VyrnCore Enterprises, a uso esclusivamente interno. Tutti i diritti riservati.
