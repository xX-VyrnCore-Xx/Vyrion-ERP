# Stack tecnologico

Le versioni esatte sono fissate nei lockfile (`backend/uv.lock`, `apps/desktop/pnpm-lock.yaml`,
`apps/desktop/src-tauri/Cargo.lock`), che fanno fede.

## Frontend

| Tecnologia | Versione | Uso |
| --- | --- | --- |
| React | 19 | Interfaccia |
| TypeScript | 6 (strict) | Tipizzazione |
| Vite | 8 | Build e dev server |
| Tailwind CSS | 4 | Stili, token di design |
| lucide-react | 1 | Icone |
| Vitest + Testing Library | 5 / 16 | Test unitari e di componente |
| ESLint + typescript-eslint + jsx-a11y | 10 | Qualità e accessibilità |

TypeScript resta alla 6 finché `typescript-eslint` non supporta la 7.

## Desktop

| Tecnologia | Versione | Uso |
| --- | --- | --- |
| Tauri | 2 | Shell nativa, installatori, aggiornamenti |
| Rust | stabile (≥ 1.80) | Core nativo |

## Backend

| Tecnologia | Versione | Uso |
| --- | --- | --- |
| Python | 3.15 | Runtime |
| FastAPI | 0.162+ | API REST, OpenAPI |
| Pydantic / pydantic-settings | 2 | Validazione e configurazione |
| SQLAlchemy | 2.1 (asyncio) | ORM |
| psycopg | 3 | Driver PostgreSQL |
| Alembic | 1.20+ | Migrazioni |
| redis-py | 8 | Client Redis |
| uv | 0.11 | Dipendenze e ambienti |
| ruff, mypy (strict), pytest | — | Qualità e test |

## Dati e infrastruttura

| Tecnologia | Versione | Uso |
| --- | --- | --- |
| PostgreSQL | 18 | Database centrale |
| SQLite | — | Database locale offline (dalla M6) |
| Redis | 8 | Cache, code, rate limiting (dalla M4) |
| Docker Compose | v2+ | Orchestrazione dei servizi |
| Caddy | 2 | Proxy HTTPS |
| Ubuntu Server su Proxmox VE | 24.04 LTS | Host |
| WireGuard | — | VPN aziendale |

## Da introdurre nelle prossime milestone

| Esigenza | Scelta prevista | Milestone |
| --- | --- | --- |
| Hashing password | `argon2-cffi` (Argon2id) | 4 |
| 2FA | TOTP (RFC 6238) | 4 |
| Archiviazione token sul client | Portachiavi di sistema via plugin Tauri | 5 |
| Stato server lato client | TanStack Query | 5 |
| Cifratura SQLite locale | SQLCipher | 6 |
| Backup | `pg_dump` + cifratura `age` | 10 |
| Aggiornamenti | `tauri-plugin-updater` con firma | 12 |
