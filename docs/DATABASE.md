# Database

## Stato attuale

Migrazioni: `0001` (baseline), `0002` (tabelle di base) e `0003` (autenticazione). Le tabelle dei
moduli ERP, CRM e IT arrivano dalle milestone 7–9.

| Tabella | Contenuto |
| --- | --- |
| `companies` | L'azienda proprietaria dell'installazione: **una sola riga**, imposta dal database |
| `users` | Utenti (soft delete) con hash della password, contatori di blocco e seme 2FA cifrato |
| `roles`, `permissions` | Ruoli e catalogo dei permessi |
| `user_roles`, `role_permissions`, `user_permissions` | Assegnazioni (le ultime sono concessioni dirette a un utente) |
| `auth_sessions` | Un dispositivo connesso: hash dei token, scadenze, revoca, indirizzo e client |
| `login_challenges` | Sfida 2FA dopo la password corretta (5 minuti, 5 tentativi) |
| `password_setup_tokens` | Token monouso per scegliere o reimpostare la password (solo hash) |
| `recovery_codes` | Codici di recupero 2FA (solo hash, monouso) |
| `login_events` | Storico degli accessi, **solo in aggiunta** |
| `audit_log` | Registro delle modifiche, **solo in aggiunta** |

### Regole imposte dal database

Valgono anche per scritture che aggirano l'applicazione:

- `companies`: al massimo una riga; `legal_form` e `tax_regime` ammettono solo i valori previsti;
  il **forfettario è ammesso solo per la ditta individuale** (`CHECK`).
- `users`: l'email è univoca tra gli utenti non eliminati (indice parziale).
- `audit_log` e `login_events`: trigger che rifiutano `UPDATE`, `DELETE` e `TRUNCATE`.
- `user_roles.role_id` è `RESTRICT`: un ruolo assegnato non si elimina.

### Reference data

Permessi e ruoli di sistema sono definiti nel codice (`app/core/permissions.py`) e copiati nel
database da `python -m app.cli bootstrap`, eseguito a ogni avvio del container dopo le migrazioni.
Il comando è idempotente: i ruoli di sistema hanno sempre esattamente i permessi del codice, i
permessi rimossi dal codice spariscono, i ruoli personalizzati non vengono toccati.

Ruoli di sistema: `super_admin`, `admin`, `manager`, `employee`, `collaborator`. Non sono
modificabili. Gli altri ruoli sono personalizzati e si creano combinando permessi del catalogo.

### Credenziali e sessioni

- I token (accesso, rinnovo, sfida, setup) **non sono mai salvati**: solo il loro hash SHA-256, con
  indice univoco. Le password sono in Argon2id; il seme TOTP è cifrato (Fernet).
- I contatori che cambiano a ogni tentativo (`failed_login_count`, `totp_last_step`,
  `last_used_at`) si aggiornano con **SQL atomico** e **non incrementano `version`**, che resta il
  contatore delle modifiche fatte da persone. Altrimenti due accessi simultanei darebbero un
  conflitto di versione.
- Le sessioni scadute o revocate si eliminano dopo 7 giorni (`python -m app.cli bootstrap`): fino
  ad allora servono a riconoscere il riuso di un token di rinnovo.

### Concorrenza e audit

- `version` è una colonna di *optimistic locking* di SQLAlchemy: una scrittura basata su una copia
  superata fallisce con `409 version_conflict`, anche se la corsa avviene dopo il controllo.
- Ogni operazione dei servizi scrive la voce di audit **nella stessa transazione** della modifica:
  non può esistere una voce per un'operazione annullata né il contrario. Le voci riportano le
  differenze campo per campo.
- Il campo `actor_user_id` usa `RESTRICT`: gli utenti si eliminano solo in modo logico, quindi la
  storia conserva sempre l'autore.

Questo documento fissa anche le convenzioni che ogni tabella futura dovrà rispettare.

## Ruoli dei database

| Database | Posizione | Ruolo |
| --- | --- | --- |
| PostgreSQL 18 | Server aziendale, volume locale | Fonte di verità |
| SQLite | Ogni postazione | Copia di lavoro offline e coda di sincronizzazione (M6) |

PostgreSQL risiede su storage locale affidabile del server. **Non va collocato su una condivisione
NAS ordinaria** (SMB/NFS): rischio di corruzione e prestazioni imprevedibili. Il NAS riceve solo
backup e documenti.

## Convenzioni

| Aspetto | Regola |
| --- | --- |
| Chiave primaria | UUID v7 (`app/core/ids.py`) generato dall'applicazione (creabile anche offline, ordinabile nel tempo) |
| Nomi | Inglese, `snake_case`, tabelle al plurale |
| Vincoli e indici | Nomi deterministici dalla naming convention in `app/db/base.py` |
| Timestamp | `timestamptz` in UTC: `created_at`, `updated_at` impostati dal server |
| Concorrenza | Colonna `version` intera, incrementata a ogni modifica (lock ottimistico e sync) |
| Eliminazione | Soft delete (`deleted_at`) dove serve storico o sincronizzazione |
| Importi | `NUMERIC(18,4)` + codice valuta ISO 4217; mai `float` |
| Tracciabilità | Ogni modifica rilevante scrive una voce di audit nella stessa transazione |
| Dati sensibili | Cifrati a livello applicativo prima della scrittura (M4) |

## Registrazioni finanziarie

Fatture emesse, movimenti contabili e pagamenti confermati sono **immutabili**: si correggono con
un documento di storno o una nota di credito, mai con un `UPDATE`. La numerazione dei documenti
fiscali è assegnata solo dal server, in sequenza senza buchi per serie e anno.

## Configurazione fiscale dell'azienda

Forma giuridica e regime fiscale sono **due attributi distinti** della tabella azienda:

| Attributo | Valori previsti |
| --- | --- |
| `legal_form` | Ditta individuale / libero professionista, SRL, SRLS, SPA |
| `tax_regime` | Forfettario, ordinario (semplificato valutabile in seguito) |

Il backend valida la combinazione: il regime forfettario è riservato alle persone fisiche; SRL,
SRLS e SPA operano in regime ordinario. Il regime determina IVA in fattura, imposta di bollo e
codice `RegimeFiscale` della FatturaPA.

## Migrazioni

```bash
cd backend
uv run alembic revision --autogenerate -m "descrizione"   # nuova revisione
uv run alembic upgrade head                               # applica
uv run alembic downgrade -1                               # annulla l'ultima
```

Regole:

- Ogni revisione ha `upgrade` e `downgrade` funzionanti, verificati dal test di round-trip.
- Una sola testa (`test_single_migration_head`).
- Le revisioni già rilasciate non si modificano: se ne crea una nuova.
- Le migrazioni distruttive avvengono in due rilasci (prima si smette di usare, poi si rimuove).
- Il container del backend esegue `alembic upgrade head` all'avvio.
