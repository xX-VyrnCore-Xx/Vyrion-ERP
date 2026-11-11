# Motore di sincronizzazione

> **Stato: progettato, non implementato (milestone 6).** Oggi il client rileva solo la
> raggiungibilità del server; non esistono ancora database locale né coda.

## Obiettivo

L'applicazione funziona senza server usando i dati locali. Al ritorno della connessione le
modifiche vengono inviate in modo **verificabile, riprendibile e idempotente**.

## Modello

Ogni modifica eseguita offline è un'**operazione** salvata in una coda locale (outbox) nella stessa
transazione SQLite della modifica ai dati.

| Campo | Significato |
| --- | --- |
| `operation_id` | UUID v7 generato dal client: chiave di idempotenza |
| `device_id` | Installazione che ha prodotto l'operazione |
| `entity`, `entity_id` | Record interessato |
| `kind` | `create`, `update`, `delete` o comando di dominio |
| `base_version` | Versione del record su cui il client ha lavorato |
| `payload` | Campi modificati (non l'intero record) |
| `depends_on` | Operazioni che devono essere applicate prima |
| `created_at` | Orario del client, solo informativo |
| `status` | `pending`, `sent`, `applied`, `conflict`, `rejected`, `failed` |

## Ciclo

1. **Riconnessione.** Il server torna raggiungibile.
2. **Autenticazione.** La sessione viene riconvalidata; se revocata, la coda resta ferma e l'utente
   deve autenticarsi di nuovo.
3. **Invio (push).** Le operazioni partono a lotti, in ordine e rispettando `depends_on`.
4. **Applicazione.** Per ogni operazione il server verifica i permessi **attuali** dell'utente,
   controlla la versione, applica e registra `operation_id`.
5. **Ricezione (pull).** Il client scarica le modifiche successive al proprio cursore.
6. **Conferma.** L'interfaccia mostra le operazioni confermate, in conflitto o rifiutate.

## Garanzie

| Garanzia | Meccanismo |
| --- | --- |
| Idempotenza | Un `operation_id` già registrato restituisce l'esito originale senza riapplicare |
| Nessuna duplicazione | Identificativi dei record generati dal client (UUID), non dal server |
| Riprendibilità | Stato per operazione; un lotto interrotto riparte dalla prima non confermata |
| Verificabilità | Registro lato server di ogni operazione con esito, utente, dispositivo e orario |
| Ordine affidabile | Versioni e sequenza del server; l'orologio del client non decide mai chi prevale |

## Conflitti

Si ha conflitto quando `base_version` è diversa dalla versione corrente sul server.

| Categoria | Politica |
| --- | --- |
| Dati ordinari (anagrafiche, note, attività) | Merge automatico per campo se i campi modificati non si sovrappongono |
| Stesso campo modificato da entrambe le parti | Risoluzione manuale: l'utente confronta e sceglie |
| Record eliminato sul server | Risoluzione manuale |
| **Dati finanziari** (fatture, pagamenti, movimenti contabili) | **Mai merge automatico** |

### Operazioni finanziarie

- Offline si creano solo **bozze**. Numerazione, emissione e registrazione contabile avvengono
  esclusivamente sul server.
- I documenti emessi sono immutabili: nessuna modifica offline può alterarli.
- Qualsiasi divergenza di versione richiede la conferma esplicita di un utente autorizzato.

## Operazioni offline autorizzate

Ogni permesso indica se è esercitabile offline. Le azioni di approvazione, emissione ed
eliminazione definitiva richiedono il server. I permessi salvati localmente abilitano l'interfaccia
offline, ma la decisione finale spetta al server al momento della sincronizzazione.

## Database locale

SQLite cifrato, con chiave custodita nel portachiavi del sistema operativo. Contiene solo i dati
che l'utente è autorizzato a vedere. Alla revoca dell'accesso il database locale viene eliminato.

## Test previsti

Idempotenza con invii ripetuti, interruzione a metà lotto, modifiche concorrenti da due dispositivi,
permessi revocati durante il periodo offline, orologio del client errato, rifiuto del merge
automatico sui dati finanziari.
