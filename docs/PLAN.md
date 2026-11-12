# Piano di sviluppo

Lo sviluppo procede per milestone. Una milestone è chiusa solo quando è **implementata, testata e
documentata**. Nessuna funzione viene mostrata nell'interfaccia prima di avere un'implementazione reale.

| # | Milestone | Stato |
| --- | --- | --- |
| 1 | Architettura e repository | ✅ Completata |
| 2 | Configurazione dell'ambiente | ✅ Completata |
| 3 | Database e backend | ✅ Completata |
| 4 | Autenticazione e autorizzazioni | ✅ Completata |
| 5 | Applicazione desktop | ⏳ Prossima |
| 6 | Sistema di sincronizzazione | Pianificata |
| 7 | Moduli ERP | Pianificata |
| 8 | Moduli CRM | Pianificata |
| 9 | Moduli IT | Pianificata |
| 10 | Backup e infrastruttura | ✅ Completata (database; vedi limiti in BACKUP.md) |
| 11 | Test e ottimizzazione | ◐ Parziale (vedi sotto) |
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

## M3 — Database e backend ✅

- Base comune: UUID v7, timestamp, `version` con optimistic locking, soft delete, paginazione a
  cursore, errori con formato uniforme (nessun dettaglio interno nelle risposte).
- Tabelle: azienda (forma giuridica + regime fiscale, vincoli nel database), utenti, ruoli,
  permessi, audit log immutabile. Dettagli in [DATABASE.md](DATABASE.md).
- Servizi con audit nella stessa transazione, validazione di partita IVA e codice fiscale,
  catalogo permessi e ruoli di sistema sincronizzati con `python -m app.cli bootstrap`.
- 70 test (di cui 27 su PostgreSQL reale): vincoli, conflitti di versione anche concorrenti,
  immutabilità dell'audit, idempotenza della sincronizzazione del catalogo.

**Non incluso, di proposito:** nessun endpoint per azienda, utenti e ruoli. Senza autenticazione e
controllo dei permessi lato server (M4) esporli sarebbe una falla; i servizi sono pronti e
verranno collegati ai router con i permessi già definiti.

## M4 — Autenticazione e autorizzazioni ✅

- Accesso con **Argon2id**, **2FA TOTP** con codici di recupero, sessioni con token opachi di breve
  durata, **rotazione del refresh token con rilevamento del riuso**, disconnessione da tutti i
  dispositivi (propria e, per gli amministratori, di un utente).
- **Protezione dalla forza bruta:** blocco dell'account, limite per indirizzo e sull'intera API
  (Redis), risposte indistinguibili tra account esistenti e no.
- **RBAC applicato dal backend** su tutte le rotte, con concessioni dirette ai singoli utenti e
  regole anti-escalation. Utenti, ruoli, azienda e audit log esposti via API.
- Nessuna password temporanea: **token monouso** per il primo accesso e i reset.
- Storico degli accessi e audit log immutabili; seme 2FA cifrato (Fernet, chiavi ruotabili).
- Comando `python -m app.cli create-admin` per il primo amministratore.
- Dettagli in [SECURITY.md](../SECURITY.md) e [API.md](API.md).

Verifiche eseguite:

| Verifica | Esito |
| --- | --- |
| Backend: ruff, mypy strict, `pip-audit` | Superati |
| 230 test (150 su PostgreSQL e Redis reali; 80 senza servizi) | Superati |
| TOTP verificato con i vettori di prova dell'RFC 6238 | Superato |
| Prova di mutazione: 7 errori inseriti apposta nei punti critici (controllo permessi, anti-escalation, ruoli protetti, rilevamento del riuso, anti-riuso TOTP, blocco account, sessione revocata) | Tutti scoperti dai test |
| Percorso completo su un **server reale** (uvicorn, database pulito, Argon2id ai parametri di produzione): primo amministratore da terminale, azienda, invito, impostazione password, ruoli, 2FA, riuso di un codice, blocco | Superato, log del server senza errori né segreti |
| Migrazione `0003`: su, giù, su; nessuna deriva | Superata |

La prova sul server reale ha trovato un difetto che i test non coprivano (il blocco cacciava anche
le sessioni già aperte del titolare): corretto e coperto da test.

Verificata anche la **stringa di avvio esatta del container**, estratta dal Dockerfile e eseguita
fuori da Docker su un database vuoto: migrazioni da zero, `bootstrap`, uvicorn, e l'indirizzo del
client passato dal proxy (`X-Forwarded-For`) finisce nello storico accessi e nel limitatore.

Non verificato: l'**immagine Docker e lo stack Compose completo** con le nuove variabili (Docker
Hub ha rifiutato gli scaricamenti per limite di richieste; la CI costruisce l'immagine ma non la
avvia) e i tempi sotto carico reale.

Rimandato di proposito (vedi [SECURITY.md](../SECURITY.md)): 2FA obbligatorio per gli
amministratori, rigenerazione dei codici di recupero, permessi sul singolo record (servono con il
primo modulo che li usa).

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

**Anticipato dalla M12:** la pipeline di build e rilascio con pulizia automatica (ultime 3
release) è scritta: vedi [RELEASING.md](RELEASING.md). Resta da fare la firma di Windows, gli
aggiornamenti automatici e la prima esecuzione reale su GitHub Actions e su runner Windows/macOS.

## M11 — Test e ottimizzazione ◐

Fatto e verificato:

- **End-to-end contro il server vero** (`apps/desktop/src/sync/__tests__/e2e.test.ts`, job CI «End-to-end»): due dispositivi, unione e conflitti, lavoro offline e ripresa, rinnovo del token, flussi della console (utenti, ruoli, audit, sessioni, stato, backup, invito).
- **Prestazioni** (`src/__tests__/performance.test.ts`): con 3000 record, inserimento ~0,5 s, ricerca 4–24 ms, indicatori 1 ms (SQLite in memoria; margini larghi per non fallire su CI lenta).
- **Backup**: ripristino confrontato riga per riga in CI (M10).
- **Revisione di sicurezza interna**: vedi [SECURITY.md](../SECURITY.md).

Non fatto: misure sul database cifrato reale (SQLCipher in Tauri), consumi/batteria, prove su
Windows e macOS reali, test di carico con più utenti, penetration test esterno.
