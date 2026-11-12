# Motore di sincronizzazione

> **Stato: implementato (versione alpha), provato end-to-end** tra due app e il server reale
> (FastAPI + PostgreSQL), oltre che con test su ciascun lato. Mancano ancora le funzioni elencate
> in *Limiti noti*.

## Collegamento in un secondo momento

L'app nasce **solo locale**. Quando si collega a un server:

1. **Adozione iniziale.** I dati già presenti vengono messi in coda una sola volta (con la loro versione) e inviati,
   perché prima del collegamento non c'era nessuna coda: l'outbox si riempie solo dopo.
2. Da quel momento ogni modifica locale finisce in `sync_outbox` e viene inviata appena possibile.
3. Il server diventa l'autorità per accesso e permessi; il singolo utente locale viene associato a
   un account del server.

Perché l'outbox si scrive solo dopo il collegamento: in modalità locale non c'è nessuno a cui
inviarla, e accumulare operazioni che nessuno consumerà farebbe crescere il database senza motivo.

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


## Come funziona oggi

| Parte | Dove | Cosa fa |
| --- | --- | --- |
| Server | `backend/app/services/sync.py`, `app/api/v1/sync.py` | `POST /sync/push` e `GET /sync/pull` (vedi [API.md](API.md)); stato corrente dei record in `sync_records`, registro immutabile in `sync_changes` |
| Client | `apps/desktop/src/sync/` | `SyncEngine` (adozione, invio, ricezione, conflitti), `HttpTransport` (accesso, rinnovo dei token) |
| Interfaccia | Impostazioni → Sincronizzazione | Accesso (con codice 2FA se serve), «Sincronizza ora», conflitti, «Scollega»; stato nella barra in alto |

- **Invio a cicli:** a ogni ciclo parte una sola operazione per record; la successiva riparte dalla
  versione che il server ha risposto. Una modifica in conflitto blocca le successive dello stesso
  record finché non viene risolta.
- **Ricezione senza perdere nulla:** un record con modifiche locali in attesa **non viene mai
  sovrascritto**; viene riscaricato al ciclo successivo. I dati ricevuti sono validati con le regole
  dell'entità prima di essere salvati.
- **Conflitti:** il client conserva la propria modifica e la copia del server e mostra le due
  versioni; la persona sceglie «Tieni la mia» (la modifica riparte sopra la versione del server) o
  «Usa quella del server» (le modifiche locali di quel record vengono scartate).
- **Dati di riferimento** (piano dei conti, fasi della pipeline) hanno lo stesso identificativo su
  ogni dispositivo; un record identico già presente sul server non è un conflitto.
- **Sessione:** i token sono salvati nel database locale cifrato, non nel browser; il refresh token
  ruota a ogni rinnovo e la nuova coppia viene salvata subito.
- **Automatica:** all'avvio, ogni minuto e quando la finestra torna attiva. Se il server non
  risponde l'app continua a funzionare e riprova.
- **Errori passeggeri:** server non raggiungibile, timeout e risposte 429/502/503/504 (server che si
  riavvia o sovraccarico) sono trattati come «offline»: nuovi tentativi a intervalli crescenti
  (5–60 s), oppure dopo il tempo indicato dal server in `Retry-After` (al massimo 5 minuti). Un rifiuto
  vero (permessi, dati non validi) non viene ritentato e compare come errore.
- **Sessione scaduta:** se il refresh token non è più valido l'app **smette di riprovare** e chiede di
  accedere di nuovo (solo la password, stesso server e account); le modifiche in attesa restano nel
  database locale e partono subito dopo l'accesso.
- **Stato visibile:** una riga nella barra in alto e nella scheda Sincronizzazione («Sincronizzato»,
  «3 modifiche in attesa», «Offline…», «Accedi di nuovo…», conflitti) con l'ora dell'ultimo scambio;
  «Copia diagnostica» produce un testo per l'assistenza (versione, server, dispositivo, stato,
  ultimo errore) **senza token né password**; «Prova il collegamento» (Impostazioni → Account e
  server) verifica l'indirizzo e mostra versione e componenti del server.

## Limiti noti

- **Numerazione fiscale con più dispositivi.** Il numero progressivo delle fatture (e della prima
  nota) è assegnato **dal dispositivo che emette**. Se due dispositivi emettono fatture, i numeri si
  scontrano. Finché la numerazione non è assegnata dal server, **un solo dispositivo deve emettere
  le fatture**; gli altri possono creare bozze, preventivi e ordini.
- Le **impostazioni** (dati dell'azienda, aspetto, indicatori della panoramica) non si sincronizzano.
- I **file allegati** non vengono inviati: si sincronizza la scheda, non il contenuto del file.
- **Ricollegarsi dopo uno scollegamento** invia di nuovo tutti i dati; quelli identici già presenti
  sul server sono riconosciuti, quelli diversi diventano conflitti.
- Un record nuovo con un campo univoco già usato su un altro dispositivo (per esempio lo stesso
  codice prodotto) non può essere salvato dal ricevente: compare tra i problemi del ciclo.
- Il server non verifica i permessi per singolo tipo di record: chi ha `core.sync:update` può
  scrivere qualsiasi tipo.
