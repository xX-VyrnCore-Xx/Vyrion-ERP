# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni secondo
[Semantic Versioning](https://semver.org/lang/it/).

## [Unreleased]

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
