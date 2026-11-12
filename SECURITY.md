# Sicurezza

La sicurezza e l'affidabilità dei dati sono la priorità del progetto. Questo documento distingue
ciò che è **in vigore** da ciò che è **pianificato**: un controllo non conta finché non è
implementato e testato.

## Segnalazioni

Le vulnerabilità vanno segnalate in privato all'amministratore IT di VyrnCore Enterprises, non
tramite issue. Non includere dati reali o credenziali nelle segnalazioni.

## Modello di minaccia (sintesi)

| Minaccia | Contromisura |
| --- | --- |
| Accesso alle API da Internet | Server raggiungibile solo dentro la VPN WireGuard |
| Intercettazione nel tunnel o nella LAN | HTTPS obbligatorio anche dentro la VPN |
| Indovinare le password | Argon2id, blocco dell'account, limite per indirizzo, tutto lato server |
| Password o seconda verifica rubate | 2FA TOTP, codici usa-e-getta, rilevamento del riuso dei token |
| Furto di un token di sessione | Token brevi, rotazione, revoca immediata, riuso rilevato |
| Utente che si attribuisce più poteri | Permessi verificati dal backend, regole anti-escalation |
| Abuso da utente interno | RBAC lato server, audit log immutabile |
| Furto o smarrimento di una postazione | Revoca delle sessioni dal server; database locale cifrato (M5–M6) |
| Dipendenze vulnerabili | Audit automatico in CI, Dependabot |
| Segreti nel repository | `.gitignore`, nessun default per i segreti, revisione delle PR |

## In vigore

### Autenticazione

- **Password con Argon2id** (RFC 9106, profilo a memoria ridotta: 64 MiB, 3 passate, 4 thread).
  In produzione il server rifiuta di avviarsi con parametri più deboli del minimo OWASP.
  L'hash viene aggiornato in modo trasparente al login se i parametri diventano più forti.
- **Politica delle password** (NIST SP 800-63B): almeno 12 caratteri, nessuna regola di
  composizione obbligatoria; rifiutate password comuni, ripetitive o contenenti l'email o il nome.
- **Nessuna password temporanea.** Un nuovo utente o un reset ricevono un **token monouso**
  (valido 72 ore, un solo token attivo per utente, conservato solo come hash) con cui scelgono la
  propria password. Il token si consegna all'utente fuori banda: finché non c'è l'integrazione
  email (milestone 8) lo comunica l'amministratore.
- **Risposte indistinguibili:** account inesistente, password errata, account disabilitato o senza
  password danno la stessa risposta e costano lo stesso tempo (verifica su un hash esca).

### Seconda verifica (2FA)

- **TOTP** (RFC 6238, verificato con il vettore di prova dello standard), tolleranza di un passo.
- Il **seme è cifrato** nel database (Fernet, autenticato). Lo stesso codice **non si può usare due
  volte**, nemmeno in condizioni di concorrenza.
- **10 codici di recupero** monouso, mostrati una sola volta e conservati solo come hash.
- Dopo la password corretta si riceve una **sfida** (5 minuti, 5 tentativi): finché non è superata
  non esiste alcun token. Un amministratore può azzerare il 2FA di chi ha perso il telefono; ciò
  chiude anche le sue sessioni.

### Sessioni e token

- **Token opachi di 256 bit** (non JWT), conservati solo come hash SHA-256. Ogni richiesta
  verifica la sessione nel database: **revoca e disattivazione hanno effetto immediato**.
- **Accesso 15 minuti; rinnovo 14 giorni; durata massima della sessione 30 giorni.**
- **Rotazione del refresh token a ogni uso.** Se un token già sostituito ricompare oltre i 10
  secondi di tolleranza, si presume una copia e **la sessione viene revocata** (con voce di audit).
- **Disconnessione da tutti i dispositivi**, propria o di un utente (amministratore). Disattivare,
  eliminare o ridurre i ruoli a un utente ne chiude le sessioni; cambiare password chiude le altre.

### Protezione dalla forza bruta

- **Blocco dell'account** dopo 5 tentativi falliti, per 15 minuti, **anche per la password
  giusta**. Vale in modo identico per gli indirizzi che non esistono, così il blocco non rivela
  chi ha un account. Il blocco dura anche se Redis viene svuotato (è nel database).
- **Limite per indirizzo** sui tentativi di accesso (30/min) e su tutta l'API (600/min), su Redis.
  Se Redis non risponde il limitatore **lascia passare** (e lo registra): il blocco dell'account,
  nel database, continua a proteggere ogni utente e un guasto non deve tagliare fuori tutti.
- Il blocco ferma i **nuovi** accessi, **non chiude le sessioni già aperte**: altrimenti chiunque
  conosca un indirizzo potrebbe disconnetterne il titolare con cinque password errate. Fa
  eccezione il caso di una sessione rubata che prova a indovinare la password dal cambio password
  o dalla disattivazione del 2FA: lì il blocco chiude tutte le sessioni.

### Autorizzazione (RBAC)

- **Ogni permesso è verificato dal backend**, per modulo, risorsa e azione
  (`core.users:create`, `core.audit_log:view`, ...). Un permesso mancante dà 403 senza rivelare
  quale servisse. Senza token si ottiene 401.
- I permessi si ricavano da **ruoli** e da **concessioni dirette** all'utente, e **valgono dalla
  richiesta successiva**, senza nuovo accesso. Un account disattivato non ha alcun permesso.
- **Regole anti-escalation:** nessuno concede permessi che non ha; i ruoli `super_admin` e `admin`
  li assegna e gestisce solo l'amministratore principale; nessuno modifica i propri ruoli o
  permessi né elimina o disattiva se stesso; l'ultimo amministratore principale attivo non si
  può rimuovere.
- I ruoli di sistema (Amministratore principale, Amministratore, Responsabile, Dipendente,
  Collaboratore) non sono modificabili; si creano ruoli personalizzati.

### Tracciabilità

- **Audit log immutabile** (trigger del database: niente modifiche, cancellazioni né `TRUNCATE`):
  chi, cosa, quando, da quale indirizzo e con quale identificativo di richiesta
  (`X-Request-ID`). Le voci sono scritte nella stessa transazione della modifica. Nessuna
  password o token compare nelle voci.
- **Storico degli accessi** immutabile: ogni tentativo riuscito o fallito, anche per indirizzi
  inesistenti, con indirizzo e client.

### Segreti, rete e validazione

- **Nessun segreto predefinito.** Il backend non parte senza URL del database, di Redis e almeno
  una chiave di cifratura valida (Fernet); Compose rifiuta l'avvio se mancano password, chiave o
  indirizzo di bind. Le chiavi supportano la **rotazione** (la prima cifra, tutte decifrano).
  Le chiavi non compaiono nelle rappresentazioni testuali della configurazione.
- **Le migrazioni e il comando `bootstrap` non richiedono segreti applicativi**, solo il database.
- **Esposizione di rete minima.** Solo il proxy pubblica una porta, legata a `VYRION_BIND_ADDRESS`
  (indirizzo WireGuard). PostgreSQL, Redis e backend vivono su una rete Docker interna.
- **Container ristretti.** Backend con utente non privilegiato, filesystem in sola lettura,
  capability rimosse, `no-new-privileges`. Redis richiede password.
- **Validazione degli input** con schemi che rifiutano campi sconosciuti e valori fuori misura;
  gli errori di validazione non riportano mai il valore ricevuto.
- **Risposte API con `Cache-Control: no-store`.** CORS ristretto alle origini dell'app desktop.
  Documentazione API interattiva disattivata in produzione. Gli errori interni non espongono
  dettagli.
- **Client:** HTTPS obbligatorio per l'indirizzo del server (HTTP solo su loopback), rifiuto di
  URL con credenziali, Content Security Policy restrittiva, capability Tauri minime.
- **Catena di fornitura:** lockfile versionati, `pip-audit` e `pnpm audit` in CI.

## Pianificato

| Controllo | Milestone |
| --- | --- |
| Token nel portachiavi di sistema, non nel webview | 5 |
| Schermate di accesso, 2FA e gestione sessioni nell'app | 5 |
| SQLite locale cifrato | 6 |
| Backup cifrati con verifica d'integrità | 10 |
| Analisi statica di sicurezza e scansione dei segreti in CI | 11 |
| Firma del codice, notarizzazione macOS, aggiornamenti firmati | 12 |

## Limiti noti e scelte da rivedere

Non sono difetti nascosti: sono decisioni prese e da conoscere.

- **Il 2FA non è obbligatorio**, nemmeno per gli amministratori. Si può imporlo come regola in
  una milestone successiva; fino ad allora è consigliato attivarlo per gli account con permessi
  `admin`.
- **Rigenerare i codici di recupero** non è ancora possibile senza disattivare e riattivare il 2FA.
- **Permessi per singolo record** non ancora implementati: nessun modulo ne ha bisogno finché non
  esistono i moduli (milestone 7–9). L'infrastruttura (permessi per modulo e azione, concessioni
  dirette) è pronta; il controllo sul singolo record si aggiunge con il primo modulo che lo usa.
- **Perdita della risposta a un rinnovo:** se un client non riceve la risposta al rinnovo del
  token e riprova oltre i 10 secondi, la sessione viene revocata e serve un nuovo accesso. È il
  prezzo del rilevamento del riuso; la tolleranza è configurabile.
- **Il blocco dell'account permette di impedire nuovi accessi a un utente** a chi ne conosce
  l'indirizzo (per 15 minuti ogni cinque tentativi). È il compromesso classico del blocco; le
  sessioni già aperte non ne risentono e un amministratore può sbloccare con un reset della password.
- **La chiave di cifratura va custodita fuori dal server.** Perderla rende inutilizzabili i 2FA
  degli utenti (si recupera con il reset del 2FA da parte di un amministratore).

## Revisione di sicurezza (milestone 11)

Revisione **interna**, non un penetration test indipendente. Cosa è stato effettivamente
controllato e come:

| Controllo | Esito | Come |
| --- | --- | --- |
| Dipendenze note vulnerabili | Nessuna | `pip-audit` e `pnpm audit --prod` eseguiti; `cargo audit` in CI |
| Segreti nel repository | Nessuno | Ricerca di chiavi private, chiavi `age`, token GitHub e AWS nei file tracciati |
| Endpoint nuovi senza autenticazione | Nessuno | `/users`, `/backups`, `/sync/status` rispondono `401` senza token; `/backups` dà `403` a un dipendente (test) |
| Documentazione API in produzione | Disattivata | `docs_url`/`openapi_url` sono `None` con `VYRION_ENVIRONMENT=production` |
| Intestazioni | `Cache-Control: no-store` su API e accessi; HSTS e `nosniff` da Caddy | Lettura del codice e prova su un server avviato |
| Messaggi di errore | Non rivelano se l'utente esiste | Accesso con utente inesistente: «Invalid credentials» |
| Backup | Cifrati con chiave pubblica; la privata non è sul server; volume in sola lettura per l'API | Test end-to-end in CI (file manomesso, chiave sbagliata) |
| Contenuto della finestra (CSP) | `default-src 'self'`, niente `unsafe-eval`, `frame-ancestors 'none'`, `freezePrototype` | `tauri.conf.json` |

Rischi accettati o aperti:

- **`connect-src` ammette `https:` e `http://localhost:*`**: l'indirizzo del server lo sceglie la
  persona, quindi non si può elencare in anticipo. L'HTTPS verso il server resta obbligatorio per
  documentazione; l'app non lo impone sul client.
- **`style-src 'unsafe-inline'`** serve a Tailwind e a React per gli stili dinamici.
- Il token di sessione del collegamento sta nel database locale cifrato (SQLCipher): protegge da un
  furto del file ma non da un malware attivo sul computer sbloccato.
- Non verificati: fuzzing delle API, test di carico con più utenti, penetration test esterno.

## Regole per chi sviluppa

1. Mai inserire nel repository credenziali, certificati privati, chiavi o file `.env`.
2. Ogni endpoint dichiara il permesso necessario con `require(...)`; l'interfaccia non è un
   controllo. Una rotta senza `require` è pubblica o aperta a qualsiasi utente autenticato: va
   scelto con consapevolezza.
3. Ogni input è validato da schemi Pydantic; le query usano sempre parametri.
4. I log, le voci di audit e le risposte non contengono password, token o chiavi.
5. Ogni nuova dipendenza va motivata e deve essere mantenuta attivamente.
6. I contatori che cambiano a ogni tentativo si aggiornano con SQL atomico, mai leggendo e
   riscrivendo.

## Segreti

| Segreto | Dove risiede |
| --- | --- |
| Password PostgreSQL e Redis | `infra/.env` sul server, permessi `600`, fuori dal repository |
| Chiave di cifratura (`ENCRYPTION_KEYS`) | `infra/.env` sul server **e una copia fuori dal server** |
| Token di sessione, setup e sfida | Solo come hash SHA-256 nel database; in chiaro solo all'utente |
| Seme TOTP | Cifrato (Fernet) nel database |
| Codici di recupero | Solo come hash; in chiaro solo alla loro emissione |
| Chiavi di firma e certificati | Segreti cifrati di GitHub Actions (M12) |
| Chiavi di cifratura dei backup | Custodite offline, separate dai backup (M10) |
