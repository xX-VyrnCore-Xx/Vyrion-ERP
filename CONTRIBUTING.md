# Contribuire

Repository privato a uso interno di VyrnCore Enterprises.

## Flusso di lavoro

1. Un ramo per modifica, partendo da `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Pull request verso `main`. Il merge richiede CI verde.
3. Nessun push diretto su `main`.

## Commit

[Conventional Commits](https://www.conventionalcommits.org/it/), in inglese:

```
feat(backend): add readiness probe
fix(desktop): reject server URLs with credentials
```

Tipi: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`.
Changelog e note di rilascio verranno generati da questi messaggi (milestone 12).

## Lingua

| Ambito | Lingua |
| --- | --- |
| Codice, commenti, nomi di tabelle, commit | Inglese |
| Interfaccia utente | Italiano (testi in `apps/desktop/src/i18n/`) |
| Documentazione | Italiano |

## Definizione di "fatto"

- [ ] Implementazione reale: nessun dato fittizio, nessun controllo dell'interfaccia privo di funzione.
- [ ] Test per il nuovo comportamento, compresi i casi d'errore.
- [ ] Permessi verificati nel backend per ogni nuovo endpoint.
- [ ] Migrazione con `upgrade` e `downgrade` se lo schema cambia.
- [ ] Documentazione e `CHANGELOG.md` aggiornati.
- [ ] Nessun segreto, certificato o file `.env` nel commit.

## Controlli locali

Backend:

```bash
cd backend && uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest
```

Desktop:

```bash
cd apps/desktop && pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

Shell Rust:

```bash
cd apps/desktop/src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

## Stile

- **Python:** ruff (formattazione e lint), mypy `strict`, funzioni asincrone per l'I/O.
- **TypeScript:** `strict`, niente `any`, componenti funzionali, testi solo nel dizionario i18n.
- **Rust:** `rustfmt`, clippy senza avvisi.
- **Accessibilità:** elementi semantici, etichette per ogni campo, navigazione da tastiera, contrasto
  adeguato in entrambi i temi.

## Dipendenze

Ogni nuova dipendenza va motivata nella pull request. I lockfile si committano sempre.

## Versioni

La versione è allineata in `backend/pyproject.toml`, `backend/app/__init__.py`,
`apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml` e
`apps/desktop/src-tauri/tauri.conf.json`.
