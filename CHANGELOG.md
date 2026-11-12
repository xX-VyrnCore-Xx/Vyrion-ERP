# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni secondo
[Semantic Versioning](https://semver.org/lang/it/).

## [Unreleased]

### Added

- **Fatture in valuta estera**: valuta e cambio (unità per 1 EUR) sul documento; prezzi delle righe nella
  valuta, totali in euro convertiti parte per parte (registri IVA, scadenzario e prima nota restano in
  euro). Incassi e pagamenti si registrano nella valuta del documento, con gli euro effettivi
  facoltativi: la differenza rispetto al valore al cambio del documento va a «Differenze cambio
  attive/passive» (conti 420 e 540); saldando tutto il residuo in valuta si azzera esattamente anche
  quello in euro. Il PDF stampa nella valuta con il controvalore in euro. Migrazione 10. Non gestiti:
  adeguamento dei cambi a fine anno, imposta di bollo sui documenti in valuta, cambi automatici.
- **Presenze e buste paga** (Personale → Presenze e buste paga): registro delle presenze con minuti
  lavorati, import CSV dal timbratore (un giorno già presente si aggiorna), ore attese del mese
  (festivi nazionali, Pasquetta inclusa, e assenze approvate) con straordinario; buste paga come
  **prospetto gestionale** con le aliquote della scheda dipendente, registrazione in prima nota (conti
  250, 251, 252) e pagamento. Non sostituisce la busta paga ufficiale del consulente del lavoro.
  Migrazione 9.
- **Registri IVA e liquidazione** (Report → Registri IVA e liquidazione): registro delle vendite e
  degli acquisti con protocollo progressivo, totali per aliquota e IVA in split payment elencata
  a parte, esportabili in CSV; **liquidazione periodica** mensile o trimestrale: IVA sulle vendite
  meno IVA sugli acquisti, credito del periodo precedente, debito sotto € 25,82 riportato,
  interessi dell'1% sui trimestri 1–3, scadenza del versamento e acconto di dicembre col metodo
  storico. «Registra la liquidazione» chiude l'IVA del periodo in prima nota (conto «Erario
  c/IVA») e si può annullare. È uno strumento di lavoro: non invia nulla e le regole generali
  vanno confermate dal commercialista.

### Changed

- Strumenti di build: pnpm 10 → 11 (`packageManager` in `apps/desktop/package.json`; il lockfile resta compatibile). Installazione pulita, controllo del formato, tipi, lint, 204 test e build verificati con pnpm 11.

- Il riepilogo IVA del periodo somma l'IVA dei singoli documenti (come i registri) invece di
  ricalcolarla sulla base aggregata, così i due coincidono al centesimo.

### Added

- **Cassa previdenziale, ritenuta d'acconto e split payment** sui documenti: la cassa (es. 4%) si
  aggiunge alla base dell'IVA con l'aliquota delle righe; la ritenuta (es. 20%, quota imponibile
  e inclusione della cassa a scelta) si calcola su compensi e cassa, mai sull'IVA; con lo split
  payment l'IVA la versa l'ente e non entra nelle registrazioni. Ogni documento mostra totale e
  **netto da incassare/pagare**: scadenzario, incassi, avvisi e prima nota usano il netto. Nuovi
  conti 135 (ritenute subite) e 230 (ritenute da versare). Regole: niente ritenuta né split nel
  regime forfettario, split e ritenuta non insieme. Il riepilogo IVA calcola sulla base con
  cassa, elenca a parte l'IVA in split e c'è un report delle ritenute (subite e operate). PDF
  aggiornato (totale documento, ritenuta, netto, diciture). I calcoli vanno fatti verificare dal
  commercialista.

### Added

- **Promemoria**: sugli appuntamenti «Promemoria (minuti prima)» e sulle attività «Ricordamelo il»
  generano avvisi nell'app (campanella e Panoramica) quando è il momento; non ci sono notifiche di
  sistema ad app chiusa.
- **Calendario .ics**: «Esporta .ics» e «Importa .ics» nel Calendario (compatibile con Outlook,
  Google e Apple Calendar). L'esportazione include allarmi e attività; l'importazione legge UTC,
  fusi orari, ora locale e giornate intere e non crea doppioni (si può riimportare lo stesso file).
  Gli eventi ricorrenti si importano solo alla prima data.
- **Ore da fatturare** (Assistenza → Ore da fatturare): gli interventi sui ticket non ancora in
  fattura diventano una bozza di fattura per cliente (una riga per ticket, in ore), con tariffa
  oraria salvata sul cliente e arrotondamento a 15/30/60 minuti. Gli interventi fatturati non si
  modificano né si fatturano di nuovo; eliminando la bozza tornano fatturabili.

### Added

- **Chiusura dell'esercizio** (Prima nota → Chiusura esercizio): sposta utile o perdita nel
  patrimonio netto, blocca le registrazioni con date dell'anno chiuso, si chiude un anno alla
  volta in ordine e si può riaprire l'ultimo. Il conto economico dell'anno chiuso resta leggibile.
  Include uno stato patrimoniale gestionale (non il bilancio civilistico).
- **Cespiti e ammortamenti**: registro dei beni durevoli, ammortamento a quote costanti (metà
  aliquota il primo anno, mai oltre il valore ammortizzabile), capitalizzazione del costo dai
  «Costi per acquisti» e registrazione annuale una sola volta.
- **Riconciliazione bancaria** (Scadenzario → Riconciliazione bancaria): importa l'estratto conto
  CSV (Data, Descrizione, Importo oppure Dare/Avere) senza doppioni e abbina i movimenti ai
  pagamenti per importo, direzione, data e numero di documento citato.
- Piano dei conti: 150 Immobilizzazioni, 151 Fondo ammortamento, 310 Utile/perdita d'esercizio,
  530 Ammortamenti (creati da soli nelle installazioni esistenti quando servono).

### Added

- **Magazzino avanzato**: più magazzini (giacenza e controllo «giacenza insufficiente» per
  magazzino, trasferimenti tra magazzini che non cambiano il valore), lotti e matricole con
  scadenza (le vendite scaricano i lotti che scadono prima, gli acquisti caricano un lotto col
  numero del documento, avvisi su lotti scaduti o in scadenza) e **valorizzazione al costo medio
  ponderato** al posto dell'ultimo prezzo di acquisto. Nuove voci Magazzini e Lotti nel menu.

### Fixed

- **Schema del database congelato**: la migrazione 2 ora è un elenco letterale (con un test che ne
  verifica l'impronta). Prima seguiva le definizioni delle entità, quindi qualunque modifica a
  un'entità avrebbe impedito di aprire i database già creati; le modifiche vengono ora da nuove
  migrazioni (la 4 aggiunge magazzini e lotti, provata su un database «vecchio» con dati).

### Added

- **PDF dei documenti** («Scarica PDF» nell'editor): preventivi, ordini, fatture, note di credito e
  fatture di acquisto con intestazione dell'azienda, destinatario, righe (a capo automatico e
  più pagine con intestazione ripetuta), riepilogo IVA per aliquota, bollo, scadenza, IBAN e note.
  Generatore PDF senza dipendenze (font standard, accenti e €). Le fatture riportano «copia di
  cortesia»: quella valida ai fini fiscali resta la fattura elettronica.
- **Importazione da CSV** (pulsante «Importa CSV» nelle liste): separatori «;», «,» o tab, BOM,
  virgolette; mappatura automatica delle colonne per etichetta (modificabile), importi e date
  all'italiana, controllo di ogni riga con le regole dell'entità, salto dei già presenti
  (partita IVA, codice fiscale, email) e report degli errori per riga. Non disponibile per
  documenti, prima nota, pagamenti e movimenti, che nascono dalle regole contabili.
- **Anagrafiche duplicate** (Anagrafiche → Duplicati): trova i doppioni per partita IVA, codice
  fiscale, email o nome (ignorando forma giuridica e punteggiatura) e li unisce in una sola
  operazione: sposta contatti, opportunità, ticket e documenti, completa i campi vuoti, conserva le
  note. Se il doppione ha documenti emessi non si unisce (restano intestati a chi è stato fatturato).

### Added

- **Test end-to-end contro il server vero in CI** (job «End-to-end»): sincronizzazione tra due
  dispositivi, lavoro offline e ripresa, conflitti, rinnovo del token e flussi della console.
  Test di prestazioni con 3000 record e revisione di sicurezza interna (SECURITY.md).
- **Backup automatico del server** (milestone 10): servizio `backup` nello stack Compose con
  `pg_dump` cifrato `age` (solo chiave pubblica sul server), checksum, rotazione 7 giornalieri /
  4 settimanali / 12 mensili, seconda destinazione verificata, controllo di integrità e prova di
  ripristino. Test end-to-end in CI (ripristino confrontato riga per riga, chiave sbagliata, file
  manomesso). Il backend legge il volume in sola lettura e ne espone lo stato in
  `GET /api/v1/backups`, per il programma di amministrazione del server.

### Added

- **Sidebar**: i gruppi CRM, ERP e IT restano sempre aperti; si chiudono solo i sottomenu al loro interno.
- **Sincronizzazione al ritorno online**: se il server o la rete non ci sono, il software lavora
  in locale e riprova da solo con pause crescenti (5, 10, 20, 40, 60 s, con conto alla rovescia);
  appena torna la rete (o il server) invia le modifiche in coda e scarica quelle degli altri.
  Le modifiche locali partono dopo pochi secondi, senza aspettare il minuto.
- Server: `GET /api/v1/sync/status` (record, modifiche, dispositivi) e `GET /api/v1/backups` per gli strumenti di amministrazione.

### Removed

- **La sezione «Server» dell'app** (console con utenti, ruoli, registro attività, sessioni, backup e
  azienda): l'amministrazione del server vivrà in un altro programma. Restano nell'app il
  collegamento al server, la sincronizzazione (con ripresa automatica al ritorno online) e la
  risoluzione dei conflitti in Impostazioni → Account e server; il server espone ancora le stesse API.

### Added

- **Ricerca globale molto più intelligente** (Ctrl/Cmd+K oppure «/»): cerca in pagine, azioni e
  record di tutto il software, capisce sinonimi (incassi → scadenzario, committente → clienti),
  plurali e errori di battitura, e capisce le intenzioni («nuovo cliente», «fatture scadute»).
  I risultati sono raggruppati (Azioni, Pagine, record, Collegati), con evidenziazione, navigazione
  da tastiera, ricerche recenti e «Intendevi…?». È un motore lessicale locale, senza modelli di IA
  né dati inviati all'esterno.

### Changed

- **Palette rinnovata** (tema scuro e chiaro): neutri freddi con una punta di viola, un solo accento
  viola con un partner azzurro per i gradienti (pulsanti principali), colori di stato più vivi ma
  leggibili, ombre morbide sulle schede e un unico bagliore statico sullo sfondo.
- **Animazioni più fluide**: ingresso breve a ogni cambio pagina, comparsa del menu account e
  dei sottomenu, schede della Panoramica che salgono una dopo l'altra e reagiscono al puntatore,
  scheletro di caricamento al posto del testo «Caricamento…», pressione dei pulsanti. Si anima solo
  `opacity` e `transform` (leggero per la GPU) e tutto si ferma se il sistema chiede meno movimento.
- **Più reattiva e a basso consumo**: con la finestra nascosta (ridotta a icona, nella barra, su un
  altro desktop) il controllo del server aspetta il ritorno invece di scattare ogni 15 secondi, la
  sincronizzazione automatica rallenta di cinque volte, le schermate non si ricaricano e le
  animazioni sono in pausa; più scritture ravvicinate fanno un solo aggiornamento delle schermate; le
  pagine si caricano in anticipo nei momenti di inattività e il cambio pagina non blocca la scrittura.
- **Sidebar rifatta, più compatta, con sottomenu.** Voci più basse e testo più piccolo; i gruppi
  CRM, ERP e IT si possono chiudere (resta visibile la voce in cui sei); molte voci hanno un
  sottomenu (per esempio Documenti → Fatture, Preventivi, Ordini…; Pipeline → Per fase, Elenco,
  Fasi) che si apre da solo sulla pagina corrente e ricorda come lo lasci.
- **Menu account e profilo** in basso nella sidebar, al posto dell'etichetta «Solo locale (nessun
  server)»: mostra profilo e stato del collegamento e porta a Profilo e azienda, Account e
  server, Impostazioni software, Aggiornamenti, Dati e backup; ha il cambio tema e «Esci da
  Vyrion ERP». Le **Impostazioni** sono ora divise in sezioni (`settings/profile`, `account`,
  `app`, `updates`, `data`) e non sono più una voce del menu principale.
- **Firma di entrambe le build, senza certificati.** L'installer Windows ora ha una firma
  Authenticode da un certificato autofirmato creato dalla CI (editore «VyrnCore Enterprises»,
  controllato a ogni build) e l'immagine disco macOS viene firmata «ad hoc» come l'app. Windows e
  Apple non si fidano di queste firme: gli avvisi restano finché non si usano certificati
  acquistati (vedi `docs/RELEASING.md`).
- **Configurazione dell'azienda in un secondo momento.** All'avvio non c'è più la schermata
  obbligatoria: tutti i moduli sono subito utilizzabili e un avviso (con «Completa ora») ricorda
  di inserire i dati aziendali, necessari solo per emettere documenti.
- **Grafica e fluidità:** menu a tendina uniformi, anello di focus, scorrimento sottile,
  transizione tra le pagine, colonne della pipeline adattive con stato vuoto; le pagine si
  caricano su richiesta (avvio più rapido), la ricerca nelle liste non interroga il database a
  ogni tasto.
- **Backend:** database locale con cache più ampia e file temporanei in memoria; il server
  comprime le risposte JSON grandi (sincronizzazione, elenchi).
- **Installer Windows:** a fine installazione chiede se avviare Vyrion ERP con Windows (resta nella
  tray); la disinstallazione toglie la voce di avvio e, se scegli di eliminare i dati, anche la
  chiave di cifratura salvata in Gestione credenziali.
- **DMG macOS ridisegnato:** titolo, due piastre dietro le icone (restano leggibili con il tema
  chiaro e scuro), freccia «trascina» e un riquadro con i tre passaggi. Se macOS dice «danneggiata»
  (l'app è firmata ma non notarizzata da Apple, e il browser aggiunge la quarantena al download)
  il comando da incollare nel Terminale è scritto nella finestra.

### Fixed

- **Windows: «Esci definitivamente» ora chiude tutto.** L'uscita dalla tray chiude icona e
  finestre e termina l'intero albero di processi (compresi quelli di WebView2 che restavano nel
  Gestore attività).
- **Windows: installazione, aggiornamento e disinstallazione** chiudono prima l'app in background
  (anche se è nella tray), così i file non risultano «in uso» e non restano processi orfani;
  la disinstallazione rimuove anche la cartella dei dati locali del programma.
- **macOS: «il file è danneggiato».** L'app nel DMG aveva solo la firma «ad hoc» del binario e
  non una firma valida del pacchetto (`code has no resources but signature indicates they must be
  present`), che macOS segnala come file danneggiato. Ora il pacchetto è firmato in modo valido
  (ad hoc) e la CI **fallisce** se la firma non verifica. L'app resta non notarizzata da Apple
  (serve un account a pagamento): al primo avvio macOS può chiedere conferma; le istruzioni sono
  nelle note di ogni release.

### Added

- **Aggiornamenti automatici dell'app.** Vyrion ERP controlla da solo (15 secondi dopo l'avvio e
  ogni sei ore; si spegne nelle impostazioni) se su GitHub c'è una versione più recente, la
  propone con un banner e la installa con un clic, senza riscaricare l'installer. I pacchetti
  sono firmati e l'app rifiuta quelli non autentici; il manifest `latest.json` e i pacchetti
  firmati vengono pubblicati con ogni release. Serve il segreto `TAURI_SIGNING_PRIVATE_KEY`
  (vedi `docs/RELEASING.md`); la prima versione con la funzione va installata a mano.
- **Windows: icona nella barra delle applicazioni.** Clic destro: apri, panoramica e avvisi, nuova
  fattura, nuova anagrafica, sincronizza ora, impostazioni/dati/backup, nascondi, **Esci
  definitivamente**. Clic sinistro: riapre la finestra. Chiudere la finestra la nasconde nella
  barra (scelta modificabile in Impostazioni → Applicazione); «Esci da Vyrion ERP» chiude davvero.
  Il database viene svuotato del registro prima dell'uscita.
- Una sola copia dell'app alla volta: aprirla di nuovo riporta in primo piano quella già attiva.

## [0.1.0] - 2026-11-11

Prima release **finale**: stesso contenuto della `0.1.0-alpha.2` (app offline-first con moduli CRM,
ERP e IT, sincronizzazione facoltativa con il server, installer con procedura guidata e icone
nuove) più il nuovo modo di rilasciare.

**Cosa non c'è ancora:** integrazione email, fatturazione elettronica (XML FatturaPA, SDI), PDF dei
documenti, permessi per singolo record, numerazione fiscale assegnata dal server (con più computer,
le fatture le emette uno solo: vedi `docs/SYNC_ENGINE.md`). Gli installer non sono firmati: Windows
mostra l'avviso «editore sconosciuto» e macOS richiede clic destro → Apri al primo avvio. L'app non
è stata provata in una finestra reale su Windows e macOS; la CI installa e disinstalla l'installer
Windows in silenzio e verifica il disco immagine macOS.

### Changed

- **Release finali e automatiche:** ogni modifica all'app che arriva su `main` costruisce gli
  installer, crea un tag nuovo `vX.Y.Z` (il numero di patch sale da solo, sempre sopra ai tag
  esistenti) e pubblica una release normale, segnata come ultima, con i file e i checksum. Se la
  build fallisce non esce nulla. Le build di `main` sono quelle della release (niente doppio
  lavoro). Vedi `docs/RELEASING.md`.

## [0.1.0-alpha.2] - 2026-11-11

Prima versione con l'app completa: **Vyrion ERP funziona da solo, offline, con i dati cifrati sul computer**,
con una prima implementazione reale dei moduli CRM, ERP e IT. Il collegamento a un server
aziendale è facoltativo e successivo.

**Anteprima tecnica (alpha).** L'integrazione email, la fatturazione elettronica (XML FatturaPA,
SDI) e i PDF dei documenti non sono ancora disponibili; con più dispositivi la numerazione delle
fatture va emessa da uno solo (vedi `docs/SYNC_ENGINE.md`).
Gli installer non sono firmati: Windows mostrerà l'avviso «editore sconosciuto» e macOS richiede
clic destro → Apri al primo avvio.

### Added

- **Offline-first.** Database locale SQLite cifrato con SQLCipher; chiave a 256 bit nel
  portachiavi del sistema; blocco di `ATTACH`, estensioni e cambi di chiave dal webview; backup
  cifrati con password e ripristino atomico; controllo di integrità; allegati per hash con verifica
  di manomissione; risorse del computer e prove TCP reali.
- **Livello dati.** Entità dichiarative (tabella, validazione, audit, outbox), audit *append-only*,
  migrazioni con checksum, blocco ottimistico, eliminazione logica, UUID v7, importi in centesimi.
- **CRM:** anagrafiche, contatti, pipeline con fasi e valore ponderato, comunicazioni, agenda,
  attività, contratti con preavviso, ticket con interventi.
- **ERP:** preventivi, ordini, fatture, note di credito, fatture di acquisto con numerazione senza
  buchi, IVA per aliquota, bollo, regime forfettario/ordinario; piano dei conti e prima nota in
  partita doppia con registrazioni automatiche e storno; scadenzario; incassi e pagamenti; magazzino;
  personale e ferie; progetti e ore; report (conto economico, IVA, bilancio di verifica) con CSV.
- **IT:** inventario, reti e indirizzi IP (CIDR), peer WireGuard (solo chiavi pubbliche), account,
  licenze, backup, eventi di sicurezza, controlli di raggiungibilità, documentazione tecnica.
- Panoramica con indicatori reali e personalizzabile, notifiche calcolate dai dati, ricerca globale,
  storico delle modifiche per record.
- **Sincronizzazione con il server** (facoltativa, attivabile in qualsiasi momento): invio e ricezione
  idempotenti, unione automatica dei campi diversi, conflitti mostrati con le due versioni, nessun
  dato contabile unito in automatico, adozione dei dati già inseriti al primo collegamento. API
  `POST /sync/push` e `GET /sync/pull`, permessi `core.sync:view` e `core.sync:update`, migrazione `0004`.
- Installer con procedura guidata curata (Windows: grafica, condizioni d'uso, cartella Start;
  macOS: sfondo del DMG) e release con titolo e nomi dei file leggibili; la release si può avviare
  da GitHub (Actions → Release) senza creare il tag a mano.

- Workflow `build.yml`: gli installer Windows e macOS (Apple Silicon) si costruiscono a ogni
  modifica dell'app desktop, con prove reali (installazione e rimozione su Windows, verifica
  dell'immagine disco su macOS) e checksum; workflow riutilizzabile `build-desktop.yml` condiviso
  con la release.
- `cargo audit` in CI.
- Accesso con Argon2id; token opachi di sessione (accesso 15 minuti, rinnovo 14 giorni, durata
  massima 30 giorni) con rotazione del refresh token e rilevamento del riuso.
- 2FA TOTP con 10 codici di recupero monouso, seme cifrato nel database, anti-riuso dei codici.
- Protezione dalla forza bruta: blocco dell'account, limite per indirizzo e sull'intera API.
- RBAC applicato dal backend su ogni rotta, con concessioni dirette ai singoli utenti e regole
  anti-escalation dei privilegi.
- API di autenticazione, utenti, ruoli, azienda e registro di audit (vedi `docs/API.md`).
- Disconnessione da tutti i dispositivi, propria o di un utente; elenco e revoca dei dispositivi.
- Token monouso per scegliere o reimpostare la password: nessuna password temporanea.
- Storico degli accessi immutabile; identificativo di richiesta (`X-Request-ID`) nell'audit.
- Migrazione `0003`; comandi `python -m app.cli create-admin` e `generate-key`; pulizia
  automatica di sessioni e token scaduti in `bootstrap`.
- Chiave di cifratura (`ENCRYPTION_KEYS`) nella configurazione di Compose.

### Verifiche

Provato in locale: 74 test del frontend (compresi flussi dell'interfaccia: primo avvio,
anagrafica, fattura emessa e incassata, collegamento al server), 256 test del backend su
PostgreSQL e Redis veri, 41 test Rust (database cifrato, backup, ripristino, allegati) e una prova
end-to-end con due app contro il server reale (adozione, unione, conflitto e risoluzione, rinnovo
dei token); lint, tipi e `clippy -D warnings` puliti.

**Non ancora verificato:** l'esecuzione dell'app in una finestra Tauri reale (non c'è uno schermo
nell'ambiente di sviluppo), il contratto tra l'interfaccia e i comandi Rust oltre ai test unitari
dei due lati, la compilazione di SQLCipher su Windows e macOS e le prove degli installer (da
controllare nella CI), le funzioni che usano finestre di dialogo del sistema (allegati, salvataggio
CSV, backup).

**Non implementato:** numerazione fiscale assegnata dal server, integrazione email, XML FatturaPA e invio SDI,
PDF dei documenti, permessi per record, blocco dell'app con PIN (i dati sono cifrati a riposo, ma
chiunque acceda all'account del sistema operativo può aprire l'app).

### Changed

- L'app non richiede più un server per funzionare; la schermata iniziale è la panoramica locale.
- **Rimossa la build per macOS Intel**: restano Windows x64 e macOS Apple Silicon.
- Installer Windows per singolo utente (senza amministratore), con WebView2 incorporato per le
  macchine senza Internet e lingua italiana; DMG con layout di trascinamento.
- Migrazioni e `bootstrap` richiedono solo l'URL del database, non i segreti applicativi.
- Il backend non parte senza almeno una chiave di cifratura valida.
- Dietro il proxy il backend si fida delle intestazioni `X-Forwarded-*` (rete interna di Docker),
  così limiti e audit vedono l'indirizzo reale del client.
- La politica delle password rifiuta qualsiasi password che contenga l'indirizzo email intero.

## [0.1.0-alpha.1] - 2026-11-11

Primo rilascio: fondamenta del progetto (milestone 1, 2 e 3) e pipeline di rilascio.

**Anteprima tecnica.** Contiene l'infrastruttura, il guscio dell'applicazione desktop e il modello
dati di base. **I moduli ERP, CRM e IT, l'autenticazione e la sincronizzazione offline non sono
ancora implementati.** Gli installer non sono firmati.

### Added

- Struttura monorepo: `apps/desktop`, `backend`, `infra`, `docs`, `tools`.
- Backend FastAPI (Python 3.15) con configurazione da variabili d'ambiente e nessun segreto
  predefinito; `GET /api/v1/health/live` e `GET /api/v1/health/ready` con verifica reale di
  PostgreSQL e Redis.
- Applicazione desktop Tauri 2 + React + TypeScript + Tailwind: configurazione dell'indirizzo del
  server, stato della connessione con retry esponenziale e riconnessione automatica, tema scuro e
  chiaro, informazioni sulla piattaforma.
- Stack Docker Compose: PostgreSQL 18, Redis 8, backend e proxy HTTPS Caddy legato all'indirizzo
  VPN.
- Modello dati di base (migrazione `0002`): azienda, utenti, ruoli, permessi, assegnazioni e audit
  log, con vincoli nel database: azienda unica, forfettario solo per ditta individuale, email
  utente univoca tra gli attivi, audit log solo in aggiunta.
- Concorrenza ottimistica (`version`), cancellazione logica, UUID v7, paginazione a cursore ed
  errori con formato uniforme `{"error": {"code", "message", "details"}}`.
- Catalogo dei permessi e ruoli di sistema, sincronizzati dal comando `python -m app.cli bootstrap`
  all'avvio del container; validazione di partita IVA e struttura del codice fiscale.
- CI GitHub Actions: lint, type-check, test unitari e di integrazione su PostgreSQL e Redis reali,
  audit delle dipendenze, validazione Compose, build dell'immagine, test degli strumenti di
  rilascio. Configurazione Dependabot.
- Pipeline di rilascio su tag: verifica che tag e versioni coincidano, installer per Windows x64
  (NSIS) e macOS Apple Silicon e Intel (DMG), checksum SHA-256, release su GitHub con alpha, beta e
  rc come pre-release.
- Pulizia automatica: dopo ogni release restano le ultime 3, in ordine di precedenza semantica;
  eseguibile anche a mano in modalità di anteprima.
- Firma e notarizzazione macOS opzionali, attive solo se i segreti sono configurati.
- Documentazione tecnica.

### Note

- Windows: l'installer non è firmato e il sistema mostrerà l'avviso "editore sconosciuto".
- Non viene prodotto l'MSI: non accetta versioni con pre-release `alpha.N`.
- Gli aggiornamenti automatici non sono ancora disponibili.

[Unreleased]: https://github.com/xX-VyrnCore-Xx/Vyrion-ERP/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/xX-VyrnCore-Xx/Vyrion-ERP/releases/tag/v0.1.0-alpha.1
