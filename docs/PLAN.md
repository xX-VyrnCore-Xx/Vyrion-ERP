# Piano di sviluppo

Lo sviluppo procede per milestone. Una milestone è chiusa solo quando è **implementata, testata e
documentata**. Nessuna funzione viene mostrata nell'interfaccia prima di avere un'implementazione reale.

| # | Milestone | Stato |
| --- | --- | --- |
| 1 | Architettura e repository | ✅ Completata |
| 2 | Configurazione dell'ambiente | ✅ Completata |
| 3 | Database e backend | ⏳ Prossima |
| 4 | Autenticazione e autorizzazioni | Pianificata |
| 5 | Applicazione desktop | Pianificata |
| 6 | Sistema di sincronizzazione | Pianificata |
| 7 | Moduli ERP | Pianificata |
| 8 | Moduli CRM | Pianificata |
| 9 | Moduli IT | Pianificata |
| 10 | Backup e infrastruttura | Pianificata |
| 11 | Test e ottimizzazione | Pianificata |
| 12 | Build e release | Pianificata |

## M1 — Architettura e repository ✅

- Monorepo `apps/desktop`, `backend`, `infra`, `docs`.
- Documentazione obbligatoria creata (14 documenti).
- `.gitignore` che esclude segreti, certificati e chiavi.

## M2 — Configurazione dell'ambiente ✅

- Backend FastAPI avviabile, configurato solo da variabili d'ambiente, senza segreti predefiniti.
- Probe `GET /api/v1/health/live` e `GET /api/v1/health/ready` (verifica reale di PostgreSQL e Redis).
- Alembic configurato con migrazione baseline.
- Shell desktop Tauri 2 + React: configurazione indirizzo server, stato connessione con retry
  esponenziale e riconnessione, tema scuro/chiaro.
- Docker Compose: PostgreSQL, Redis, backend, proxy HTTPS legato all'indirizzo WireGuard.
- CI GitHub Actions: qualità, test unitari e di integrazione, audit dipendenze, build immagine.

Verifiche eseguite:

| Verifica | Esito |
| --- | --- |
| Backend: ruff, mypy strict, pytest (12 test, 2 di integrazione su PostgreSQL/Redis reali) | Superata |
| Desktop: eslint, tsc strict, vitest (18 test), build di produzione | Superata |
| Shell Rust: rustfmt, clippy `-D warnings`, cargo test | Superata (Linux) |
| Stack Compose avviato: `ready` → 200 via HTTPS; Redis fermo → 503 `degraded` | Superata |
| Flusso UI in browser reale contro backend reale | Superata |

Non ancora verificato: build e installatori su **Windows e macOS** (milestone 12), che richiedono
runner dedicati e certificati di firma.

## M3 — Database e backend (prossima)

- Modello base comune: UUID, `created_at`/`updated_at`, `version` per concorrenza ottimistica,
  soft delete.
- Tabelle fondamentali: azienda (forma giuridica + regime fiscale), utenti, ruoli, permessi, audit log.
- Livello repository/servizi, gestione errori uniforme, paginazione e filtri.
- Test di integrazione delle migrazioni (upgrade/downgrade) per ogni revisione.

## M4 — Autenticazione e autorizzazioni

Argon2id, sessioni, refresh token a rotazione, 2FA TOTP, protezione brute force, blocco account,
revoca sessioni e disconnessione globale, RBAC con permessi granulari verificati dal backend.

## M5 — Applicazione desktop

Login, layout completo, ricerca globale, centro notifiche, tabelle avanzate, dashboard con widget.
Chiamate di rete spostate nel lato Rust per l'archiviazione sicura dei token nel portachiavi di sistema.

## M6 — Sincronizzazione

SQLite locale cifrato, coda di operazioni idempotenti, versionamento, rilevamento conflitti.
Vedi [SYNC_ENGINE.md](SYNC_ENGINE.md).

## M7–M9 — Moduli

Vedi [MODULES.md](MODULES.md). Ordine interno: anagrafiche → documenti di vendita → contabilità;
clienti → pipeline → ticket; inventario → monitoraggio → scadenze.

## M10–M12

Backup cifrati con verifica e test di ripristino ([BACKUP.md](BACKUP.md)); test end-to-end, di
sicurezza e prestazioni; build firmate Windows/macOS, notarizzazione, aggiornamento automatico,
release e changelog automatici.
