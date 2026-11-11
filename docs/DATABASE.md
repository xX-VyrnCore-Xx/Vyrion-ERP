# Database

## Stato attuale

Lo schema è **vuoto**: esiste solo la migrazione baseline `0001`, che avvia la catena Alembic.
Le tabelle di dominio arrivano dalla milestone 3. Questo documento fissa le convenzioni che ogni
tabella dovrà rispettare.

## Ruoli dei database

| Database | Posizione | Ruolo |
| --- | --- | --- |
| PostgreSQL 16 | Server aziendale, volume locale | Fonte di verità |
| SQLite | Ogni postazione | Copia di lavoro offline e coda di sincronizzazione (M6) |

PostgreSQL risiede su storage locale affidabile del server. **Non va collocato su una condivisione
NAS ordinaria** (SMB/NFS): rischio di corruzione e prestazioni imprevedibili. Il NAS riceve solo
backup e documenti.

## Convenzioni

| Aspetto | Regola |
| --- | --- |
| Chiave primaria | UUID v7 generato dall'applicazione (creabile anche offline, ordinabile nel tempo) |
| Nomi | Inglese, `snake_case`, tabelle al plurale |
| Vincoli e indici | Nomi deterministici dalla naming convention in `app/db/base.py` |
| Timestamp | `timestamptz` in UTC: `created_at`, `updated_at` impostati dal server |
| Concorrenza | Colonna `version` intera, incrementata a ogni modifica (lock ottimistico e sync) |
| Eliminazione | Soft delete (`deleted_at`) dove serve storico o sincronizzazione |
| Importi | `NUMERIC(18,4)` + codice valuta ISO 4217; mai `float` |
| Tracciabilità | `created_by`, `updated_by`; modifiche rilevanti nell'audit log |
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
