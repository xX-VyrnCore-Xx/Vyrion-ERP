# API

API REST in JSON, descritta da OpenAPI. Base: `https://<server>/api/v1`.

In sviluppo la specifica è disponibile su `/openapi.json` e la documentazione interattiva su `/docs`.
**In produzione entrambe sono disattivate.**

## Autenticazione

Le richieste protette portano `Authorization: Bearer <access_token>`. Senza token, o con un token
non valido, scaduto o revocato, la risposta è `401` con `WWW-Authenticate: Bearer`. Con un token
valido ma senza il permesso necessario è `403`.

```
POST /auth/login ──► authenticated ──────────────► access_token (15 min) + refresh_token (14 gg)
        │
        └─► second_factor_required ──► POST /auth/login/second-factor ──► access + refresh
```

Il refresh token **ruota a ogni uso**: ogni risposta di `/auth/refresh` contiene una coppia nuova
e la precedente smette di valere. Va sempre sostituito quello salvato.

Ogni risposta riporta `X-Request-ID` (se il client ne invia uno valido viene mantenuto) e
`Cache-Control: no-store`.

### Accesso e sessioni

| Metodo e percorso | Accesso | Funzione |
| --- | --- | --- |
| `POST /auth/login` | pubblico | Email e password. `status` vale `authenticated` (con `tokens`) oppure `second_factor_required` (con `second_factor.challenge_token`) |
| `POST /auth/login/second-factor` | pubblico | `challenge_token` e `code` (TOTP di 6 cifre o codice di recupero) → token |
| `POST /auth/refresh` | pubblico | `refresh_token` → nuova coppia di token |
| `POST /auth/password/setup` | pubblico | `token` monouso e `new_password`: primo accesso o reset |
| `POST /auth/logout` | sessione | Chiude questa sessione |
| `POST /auth/logout-all` | sessione | Chiude tutte le sessioni, questa compresa |
| `GET /auth/me` | sessione | Utente, elenco dei permessi effettivi, sessione |
| `GET /auth/sessions` | sessione | Dispositivi connessi (`current` indica questo) |
| `DELETE /auth/sessions/{id}` | sessione | Disconnette un proprio dispositivo (`404` se non è tuo) |
| `GET /auth/login-history` | sessione | Ultimi accessi e tentativi falliti del proprio account |
| `POST /auth/password/change` | sessione | `current_password`, `new_password`; chiude le altre sessioni |

### Seconda verifica

| Metodo e percorso | Funzione |
| --- | --- |
| `POST /auth/2fa/setup` | Genera il seme e l'URI `otpauth://` (da mostrare come QR). Non attiva ancora nulla |
| `POST /auth/2fa/enable` | Conferma con un codice, attiva il 2FA e restituisce i **10 codici di recupero (una sola volta)** |
| `POST /auth/2fa/disable` | Richiede `password` e `code` |

### Esito degli errori di accesso

| Caso | Risposta |
| --- | --- |
| Credenziali errate, account inesistente, disabilitato o senza password | `401 unauthenticated`, identiche tra loro |
| Troppi tentativi (account o indirizzo) | `429 rate_limited` con `Retry-After` e `details.retry_after_seconds` |
| Password nuova non accettabile | `422 invalid_input`, con l'elenco dei motivi in `details.password` |
| Password attuale sbagliata (cambio password) | `422`, non `401`, per non farla scambiare per una sessione scaduta |

## Amministrazione

Ogni percorso richiede il permesso indicato. Le regole che dipendono da *chi* agisce e *su chi*
(non concedere ciò che non si ha, gestire amministratori, non agire su se stessi) danno `403`.

### Utenti

| Metodo e percorso | Permesso | Funzione |
| --- | --- | --- |
| `GET /users` | `core.users:view` | Elenco paginato |
| `POST /users` | `core.users:create` | Crea l'account **senza password**; la risposta contiene `setup_token` (una sola volta) |
| `GET /users/{id}` | `core.users:view` | Dettaglio |
| `PATCH /users/{id}` | `core.users:update` | Modifica parziale con `version`; `is_active` richiede anche `core.users:admin` |
| `DELETE /users/{id}?version=N` | `core.users:delete` | Eliminazione logica, libera l'email |
| `PUT /users/{id}/roles` | `core.users:admin` | Sostituisce i ruoli (`roles`, `version`) |
| `PUT /users/{id}/permissions` | `core.users:admin` | Sostituisce le concessioni dirette (`permissions`, `version`) |
| `POST /users/{id}/revoke-sessions` | `core.users:admin` | Disconnette l'utente da tutti i dispositivi |
| `POST /users/{id}/password-reset` | `core.users:admin` | Nuovo `setup_token`; annulla i precedenti |
| `POST /users/{id}/2fa/reset` | `core.users:admin` | Disattiva il 2FA e chiude le sessioni |

### Ruoli, azienda, audit

| Metodo e percorso | Permesso | Funzione |
| --- | --- | --- |
| `GET /roles`, `GET /roles/{id}` | `core.roles:view` | Ruoli con i loro permessi |
| `GET /roles/permissions` | `core.roles:view` | Catalogo dei permessi assegnabili |
| `POST /roles` | `core.roles:create` | Nuovo ruolo personalizzato |
| `PUT /roles/{id}/permissions` | `core.roles:update` | Sostituisce i permessi (non per i ruoli di sistema) |
| `DELETE /roles/{id}?version=N` | `core.roles:delete` | Solo se non assegnato |
| `GET /company` | `core.company:view` | `404` finché l'azienda non è configurata |
| `PUT /company` | `core.company:update` | Senza `version` crea, con `version` aggiorna |
| `GET /audit-log` | `core.audit_log:view` | Più recenti per primi; filtri `entity_type`, `entity_id`, `actor_user_id`, `action`, `since`, `until` |

Il registro di audit non ha percorsi di scrittura: `POST`, `PUT`, `PATCH` e `DELETE` danno `405`.

## Salute del server

### `GET /health/live`

Il processo è attivo. Non interroga le dipendenze. Pubblico e fuori dal limite di richieste.

```json
{ "status": "ok", "version": "0.1.0-alpha.1" }
```

### `GET /health/ready`

Verifica reale di PostgreSQL (`SELECT 1`) e Redis (`PING`), ciascuna con timeout
(`VYRION_HEALTH_CHECK_TIMEOUT`, predefinito 2 s). Usato dal client per stabilire se il server è
raggiungibile. Pubblico.

| Stato HTTP | Significato |
| --- | --- |
| `200` | Tutte le dipendenze rispondono |
| `503` | Almeno una dipendenza non risponde; il corpo indica quale |

```json
{
  "status": "ok",
  "version": "0.1.0-alpha.1",
  "components": {
    "database": { "status": "ok", "latency_ms": 4.96 },
    "redis": { "status": "ok", "latency_ms": 0.91 }
  }
}
```

In caso di errore il componente riporta `{ "status": "error", "latency_ms": null }`. I dettagli
tecnici restano nei log del server.

## Formato degli errori

Per tutte le risposte di errore:

```json
{ "error": { "code": "version_conflict", "message": "…", "details": { "current_version": 3 } } }
```

| Codice | HTTP | Uso |
| --- | --- | --- |
| `invalid_input` | 422 | Richiesta non valida |
| `unauthenticated` | 401 | Non autenticato o credenziali errate |
| `forbidden` | 403 | Permesso mancante o regola di autorizzazione |
| `not_found` | 404 | Risorsa inesistente |
| `conflict` | 409 | Duplicato o stato incompatibile |
| `version_conflict` | 409 | Modificato da altri: `details` riporta `expected_version` e `current_version` |
| `rate_limited` | 429 | Troppe richieste o tentativi; vedere `Retry-After` |
| `internal_error` | 500 | Errore del server, senza dettagli |

Gli errori di validazione elencano campo, messaggio e tipo, **mai il valore ricevuto**.

## Convenzioni

| Aspetto | Regola |
| --- | --- |
| Versione | Prefisso `/api/v1`; modifiche incompatibili → `/api/v2` |
| Risorse | Sostantivi plurali in `kebab-case`: `/sales-orders/{id}` |
| Campi JSON | `snake_case` |
| Identificativi | UUID |
| Date | ISO 8601 in UTC |
| Importi | Stringhe decimali (`"1250.00"`) + valuta; mai numeri in virgola mobile |
| Concorrenza | `version` nel corpo (o `?version=` per `DELETE`); `409 version_conflict` se superata |
| Paginazione | A cursore: `?limit=&cursor=` → `{ "items": [], "next_cursor": null }` (`limit` 1–200) |
| Idempotenza | Intestazione `Idempotency-Key` sulle scritture ripetibili (obbligatoria per la sync, M6) |
| Permessi | Ogni rotta protetta dichiara il permesso con `require(...)` |

## CORS

Origini ammesse: `tauri://localhost`, `http(s)://tauri.localhost` e, in sviluppo,
`http://localhost:1420`. Configurabili con `VYRION_CORS_ORIGINS` (lista JSON).

## Sincronizzazione (`/api/v1/sync`)

Usata dall'app desktop **dopo** il collegamento al server. Permessi: `core.sync:update` (invio) e
`core.sync:view` (ricezione); li hanno Amministratore, Responsabile e Dipendente.

### `POST /sync/push`

Corpo: `{ "device_id": uuid, "operations": [ … ] }` (da 1 a 200 operazioni). Ogni operazione:

| Campo | Significato |
| --- | --- |
| `op_id` | UUID scelto dal client: chiave di idempotenza |
| `entity`, `entity_id` | Tipo e identificativo del record (nome in minuscolo con `_`) |
| `kind` | `create` (parte da `base_version` 0), `update` (solo i campi cambiati) o `delete` |
| `base_version` | Versione del record su cui il client ha lavorato |
| `version` | Solo per `create`: versione già posseduta (prima connessione) |
| `payload` | Campi del record; `id`, `version`, `deleted_at` sono riservati; `updated_at` non genera mai conflitti |

Risposta: un esito per operazione, indipendente dalle altre:

| `status` | Significato |
| --- | --- |
| `applied` | Applicata; `version` è la nuova versione del record |
| `merged` | Versione base più vecchia, ma i campi toccati non si sovrappongono a quelli cambiati nel frattempo: unita automaticamente |
| `duplicate` | Stesso `op_id` già applicato: restituisce l'esito originale |
| `conflict` | Non applicata. `reason` (`same_fields_changed`, `financial_record_changed`, `changed_since`, `deleted`, `missing`, `already_exists`), `conflicting_fields` e la copia attuale del server in `server` |
| `rejected` | Operazione incoerente (versione mai vista dal server, `op_id` riusato per un altro record) |

I record **finanziari** (`document`, `document_line`, `payment`, `journal_entry`, `journal_line`,
`stock_movement`) non si uniscono mai in automatico: ogni differenza di versione è un conflitto.
Un record non si elimina mai sopra modifiche che chi elimina non ha visto.

### `GET /sync/pull?device_id=…&after=…&limit=…`

Record modificati da altri dispositivi (o risultato di un'unione) dopo il cursore `after`, ciascuno
nel suo stato più recente, dal più vecchio. La risposta contiene `cursor` da riusare come `after` e
`has_more`. Il dispositivo che ha fatto la modifica non la riceve di ritorno, ma il cursore avanza.

Le richieste di invio sono serializzate (blocco consultivo PostgreSQL): l'ordine di commit coincide
con l'ordine di sequenza e un cursore non può saltare una modifica registrata in ritardo.
