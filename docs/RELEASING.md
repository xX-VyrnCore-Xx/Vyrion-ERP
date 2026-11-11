# Rilasci

Un rilascio nasce da un **tag** su `main`. Il tag avvia la build degli installer, pubblica la
release su GitHub e poi elimina le release più vecchie: ne restano **le ultime 3**.

> **Stato:** la pipeline è scritta e le sue parti verificabili in locale sono provate (logica di
> versionamento e di potatura, lint dei workflow, compilazione di release del guscio Rust su
> Linux).
> **Non è ancora stata eseguita su GitHub Actions** né su runner Windows e macOS: la prima
> esecuzione reale è il primo tag. Gli installer escono **non firmati** finché non si configurano
> i segreti descritti più sotto.

## Versioni

[Semantic Versioning](https://semver.org/lang/it/) con quattro canali:

| Tag | Canale | Su GitHub |
| --- | --- | --- |
| `v0.2.0-alpha.1` | Alpha | Pre-release |
| `v0.2.0-beta.1` | Beta | Pre-release |
| `v0.2.0-rc.1` | Release Candidate | Pre-release |
| `v0.2.0` | Stable | Release (segnata *latest*) |

Altri formati di tag non avviano nulla.

La versione è scritta in **7 file** (due `package.json`/`tauri.conf.json`, `Cargo.toml` e
`Cargo.lock`, `pyproject.toml`, `uv.lock`, `app/__init__.py`). Il `Cargo.lock` è incluso perché
`cargo build --locked` rifiuta un lockfile che non coincide con `Cargo.toml`. Non si modificano a
mano:

```bash
python3 tools/release/version.py set 0.2.0-alpha.1
```

```bash
python3 tools/release/version.py check
```

`check` fallisce se anche un solo file diverge; la CI lo esegue a ogni modifica.

## Come si pubblica

Ci sono due modi equivalenti. In entrambi la release prende il titolo dal numero di versione
(`0.1.0-alpha.1` → **Vyrion ERP 0.1.0 Alpha 1**) e i file hanno nomi leggibili.

**A. Dall'interfaccia di GitHub (consigliato):** *Actions → Release → Run workflow* sul ramo
`main`, scrivendo la versione (per esempio `0.1.0-alpha.1`). Il workflow controlla che i file di
versione coincidano, rifiuta una versione già pubblicata, costruisce gli installer e **crea da solo
il tag** sulla punta di `main`.

**B. Da terminale:** crea e invia il tag, come descritto sotto.

1. Aggiorna `CHANGELOG.md`: sposta il contenuto di `[Unreleased]` in una sezione
   `## [0.2.0-alpha.1] - AAAA-MM-GG`. Il testo di quella sezione diventa la parte iniziale delle
   note di rilascio, seguita dalle note generate da GitHub.
2. Imposta la versione con `version.py set` (vedi sopra) e fai il commit su `main` tramite PR.
3. Con `main` aggiornato, crea e invia il tag:

```bash
git tag v0.2.0-alpha.1 && git push origin v0.2.0-alpha.1
```

## Cosa fa la pipeline

Workflow: `.github/workflows/release.yml`, che usa la stessa definizione di build delle pull
request (`build-desktop.yml`): ciò che si rilascia è ciò che la CI ha già costruito.

| Job | Compito |
| --- | --- |
| `verify` | Il tag ha il formato giusto; **tutti i file di versione coincidono con il tag**; il commit è su `main`; i test degli strumenti passano |
| `build` | Due installer in parallelo (uno che fallisce non ferma l'altro), firmati se i segreti esistono |
| `release` | Calcola gli `SHA256SUMS.txt`, compone le note, crea la release e allega i file |
| `prune` | Elimina le release oltre le ultime 3 (solo se `release` è riuscito) |

Installer prodotti:

| Piattaforma | File | Formato |
| --- | --- | --- |
| Windows 10/11 x64 | `Vyrion-ERP_<versione>_Windows-x64-Setup.exe` | NSIS |
| macOS Apple Silicon | `Vyrion-ERP_<versione>_macOS-AppleSilicon.dmg` | DMG |

**Non esiste una build per macOS Intel**, per scelta.

L'installer **MSI non è prodotto**: WiX accetta solo identificatori di pre-release numerici, quindi
rifiuterebbe versioni come `0.2.0-alpha.1`. Si potrà aggiungere per le sole versioni stable.

## Build su ogni pull request

`.github/workflows/build.yml` costruisce gli stessi due installer (non firmati, conservati 7
giorni) a ogni modifica a `apps/desktop`, così una build rotta si scopre nella PR e non il giorno
del rilascio. Ogni build:

- esegue controllo dei tipi e test del frontend prima di compilare;
- rifiuta un installer sospettosamente piccolo (meno di 1 MB);
- **Windows:** installa l'installer in modo silenzioso in una cartella temporanea, verifica che
  l'eseguibile sia presente, lo disinstalla e verifica che sia stato rimosso;
- **macOS:** verifica l'immagine disco (`hdiutil verify`), la apre, controlla il pacchetto `.app`
  e che il binario sia `arm64`, e riporta lo stato della firma;
- scrive un checksum SHA-256 accanto a ogni installer; la release li riunisce e li **riverifica**
  dopo il download.

### Procedura guidata di installazione

- **Windows (NSIS):** schermata di benvenuto con grafica del marchio, pagina con le condizioni
  d'uso (`apps/desktop/src-tauri/installer/LICENSE.txt`, **testo provvisorio da far rivedere a un
  legale**), scelta della cartella, cartella nel menu Start «VyrnCore» e, a fine installazione, la
  casella per avviare subito l'app. La disinstallazione offre di eliminare anche i dati (non
  selezionato di default). Lingua italiana.
- **macOS (DMG):** finestra con sfondo e freccia «trascina in Applicazioni».
- La grafica si rigenera con `python3 tools/installer-assets/generate.py` (i file sono nel
  repository: le build non richiedono Pillow).
- Il programma di installazione Windows non è stato guardato su una finestra reale: la CI lo
  installa e lo disinstalla in modo silenzioso, ma le pagine grafiche del wizard non sono verificate
  da prove automatiche.

Gli installer sono configurati per un'app che lavora offline:

- **Windows:** installazione per utente (nessun amministratore, nessun UAC), runtime WebView2
  **incorporato** nell'installer (funziona su macchine senza Internet), lingua italiana;
- **macOS:** richiede macOS 12 o successivo; finestra del DMG con la classica icona di
  trascinamento in Applicazioni.

Se una build fallisce, la release non viene creata. Correggi, sposta il tag sul commit buono o
usa un nuovo numero di versione, e riparti. Rieseguire un workflow già riuscito in parte aggiorna
gli allegati senza duplicare la release.

## Pulizia automatica

Dopo ogni release riuscita (`.github/workflows/prune-releases.yml`, script
`tools/release/prune.sh`) restano solo le **3 versioni più recenti**; per le altre vengono
eliminate la release **e il tag**.

Regole di sicurezza:

- L'ordine è quello di Semantic Versioning, **non la data**: `0.3.0-rc.1` è più recente di
  `0.2.9`, e `0.3.0` più recente di `0.3.0-rc.1`. Un tag di correzione su una linea vecchia non
  può quindi eliminare versioni più nuove.
- Contano insieme alpha, beta, rc e stable.
- Sono considerati solo i tag `vX.Y.Z` e `vX.Y.Z-(alpha|beta|rc).N`; **qualsiasi altro tag
  (`latest`, backup, ecc.) non viene mai toccato**.
- Se il tag appena rilasciato **non** rientrerebbe tra i 3 più recenti (per esempio si pubblica
  una correzione su una linea vecchia), la pulizia **non elimina nulla** e segnala un avviso.
- Se GitHub non risponde in modo chiaro, lo script si ferma senza eliminare.
- Con 3 tag o meno non succede nulla.

Anteprima senza conseguenze: **Actions → Prune releases → Run workflow**, con *dry run* attivo
(è il valore predefinito). Mostra l'elenco di ciò che verrebbe eliminato.

**Attenzione:** l'eliminazione è definitiva. Una release e un tag eliminati non si recuperano da
GitHub; si possono solo ricreare dal commit, se lo si conosce. Per cambiare il numero di release
conservate modifica `keep` in `release.yml`.

## Firma e notarizzazione

Sono attive solo se esistono i segreti nel repository (*Settings → Secrets and variables →
Actions*). Senza, gli installer si producono ma non sono firmati.

**macOS** (firma + notarizzazione, tutti obbligatori insieme):

| Segreto | Contenuto |
| --- | --- |
| `APPLE_CERTIFICATE` | Certificato "Developer ID Application" `.p12`, in base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Password del `.p12` |
| `APPLE_SIGNING_IDENTITY` | Per esempio `Developer ID Application: Nome (TEAMID)` |
| `APPLE_ID` | Account Apple Developer |
| `APPLE_PASSWORD` | Password specifica per app |
| `APPLE_TEAM_ID` | Identificativo del team |

Richiede un account Apple Developer a pagamento.

**Windows:** la firma **non è ancora configurata**. Serve un certificato di firma del codice
(idealmente EV, per evitare gli avvisi di SmartScreen) e la configurazione di Tauri
(`bundle.windows`). Fino ad allora Windows mostrerà l'avviso "editore sconosciuto".

I certificati e le chiavi non vanno mai nel repository (`.gitignore` esclude `.p12`, `.pem`,
`.key` e simili).

## Aggiornamenti automatici

**Non implementati.** Richiedono `tauri-plugin-updater`, una coppia di chiavi di firma degli
aggiornamenti e un punto di distribuzione dei metadati: sono previsti nella milestone 12.
Le release a rotazione (3) non sono adatte come archivio per l'updater: prima di attivarlo, va
deciso dove conservare gli aggiornamenti.

## Verifiche eseguite

In locale, sul codice di questa pipeline:

- 41 test sugli strumenti: precedenza delle versioni, formato dei tag, coerenza dei 7 file,
  estrazione del changelog.
- Prova della pulizia end-to-end su un repository git reale con remoto e un `gh` simulato: restano
  i 3 tag più recenti, i tag estranei sopravvivono, il dry run non cambia nulla, un errore
  imprevisto di GitHub non elimina nulla.
- Prova di mutazione: introducendo apposta 4 errori nella logica di potatura, i test li rilevano
  tutti.
- `actionlint` sui workflow e `shellcheck` sullo script.
- `tauri build --no-bundle` su Linux: build del frontend e compilazione di release del guscio Rust
  (profilo con LTO, 2 min 42 s) riuscite. Non copre la creazione degli installer NSIS e DMG.

Non verificato: l'esecuzione su GitHub Actions, le build su Windows e macOS, la creazione degli
installer (NSIS e DMG), i permessi reali del
token (`contents: write`) e il comportamento di `gh release delete --cleanup-tag` sul repository
vero.
