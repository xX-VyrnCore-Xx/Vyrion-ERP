# API

API REST in JSON, descritta da OpenAPI. Base: `https://<server>/api/v1`.

In sviluppo la specifica è disponibile su `/openapi.json` e la documentazione interattiva su `/docs`.
**In produzione entrambe sono disattivate.**

## Endpoint disponibili

### `GET /api/v1/health/live`

Il processo è attivo. Non interroga le dipendenze.

```json
{ "status": "ok", "version": "0.1.0-alpha.1" }
```

### `GET /api/v1/health/ready`

Verifica reale di PostgreSQL (`SELECT 1`) e Redis (`PING`), ciascuna con timeout
(`VYRION_HEALTH_CHECK_TIMEOUT`, predefinito 2 s). Usato dal client per stabilire se il server è
raggiungibile.

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

In vigore da ora per tutte le risposte di errore:

```json
{ "error": { "code": "version_conflict", "message": "…", "details": { "current_version": 3 } } }
```

Codici: `invalid_input` (422), `unauthenticated` (401), `forbidden` (403), `not_found` (404),
`conflict` (409), `version_conflict` (409), `rate_limited` (429), `internal_error` (500). Gli errori
di validazione elencano campo, messaggio e tipo, **mai il valore ricevuto**; gli errori interni non
espongono dettagli.

## Convenzioni per i prossimi endpoint

| Aspetto | Regola |
| --- | --- |
| Versione | Prefisso `/api/v1`; modifiche incompatibili → `/api/v2` |
| Risorse | Sostantivi plurali in `kebab-case`: `/sales-orders/{id}` |
| Campi JSON | `snake_case` |
| Identificativi | UUID |
| Date | ISO 8601 in UTC |
| Importi | Stringhe decimali (`"1250.00"`) + valuta; mai numeri in virgola mobile |
| Autenticazione | `Authorization: Bearer <token>` (M4) |
| Idempotenza | Intestazione `Idempotency-Key` sulle scritture ripetibili (obbligatoria per la sync) |
| Concorrenza | Campo `version` nel corpo; `409 Conflict` se superato |
| Paginazione | A cursore: `?limit=&cursor=` → `{ "items": [], "next_cursor": null }` |
| Errori | `{ "error": { "code": "...", "message": "...", "details": {} } }` |

| Codice | Uso |
| --- | --- |
| `400` / `422` | Richiesta non valida |
| `401` | Non autenticato |
| `403` | Permesso mancante |
| `404` | Risorsa inesistente o non visibile all'utente |
| `409` | Conflitto di versione o di stato |
| `429` | Limite di richieste superato |

## CORS

Origini ammesse: `tauri://localhost`, `http(s)://tauri.localhost` e, in sviluppo,
`http://localhost:1420`. Configurabili con `VYRION_CORS_ORIGINS` (lista JSON).
