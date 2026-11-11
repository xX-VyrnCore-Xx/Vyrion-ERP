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

**Di norma non si fa nulla: la release è automatica e finale.** Ogni volta che una modifica a
`apps/desktop/` (o a `build-desktop.yml`) arriva su `main`, il workflow *Release* costruisce gli
installer, crea un **tag nuovo `vX.Y.Z`** e pubblica una **release normale, segnata come ultima**
(non una pre-release), con i file e i checksum. Se la build fallisce non esce nessuna release.

Il numero lo sceglie `tools/release/next_version.py`:

| Situazione | Versione rilasciata |
| --- | --- |
| La linea `X.Y` della versione nei file non ha ancora una release | quella dei file (es. `0.1.0`) |
| Esiste già `v0.1.0` | la patch sale: `0.1.1`, `0.1.2`, … sempre più alta di qualunque tag stabile esistente della stessa linea (anche dopo la pulizia di quelli vecchi) |
| Nei file c'è una linea nuova (es. `0.2.0`, `1.0.0`) | quella dei file: la nuova linea parte da lì |
| Nei file c'è un suffisso `-alpha.N` / `-rc.N` | il suffisso viene ignorato: si rilascia sempre il numero finale |

La versione scelta viene scritta **solo nella copia di lavoro della build** (non viene committata),
così installer, nome del file e tag coincidono; i file del repository restano alla versione che
decidi tu. Per cambiare linea (per esempio `0.2.0`) imposta la versione con `version.py set` e fai
il commit come sempre.

Le note della release usano la sezione del `CHANGELOG.md` della versione, se esiste; per le release
automatiche senza sezione, il commit, i limiti noti e l'elenco delle modifiche generato da GitHub.
Si rilascia **una alla volta** (gruppo di concorrenza comune): se arrivano due modifiche
ravvicinate, la seconda attende e prende il numero successivo. Le modifiche che non toccano l'app
(solo backend, documenti) non producono installer né release.

Restano due modi manuali (utili anche per una pre-release a mano, es. `0.2.0-rc.1`):

**A. Da GitHub:** *Actions → Release → Run workflow* sul ramo `main`, con la versione scritta nei
file (per esempio `0.1.0-alpha.3`). Rifiuta una versione già pubblicata.

**B. Da terminale:** crea e invia il tag, come descritto sotto.

## Cosa fa la pipeline

Workflow: `.github/workflows/release.yml`, che usa la stessa definizione di build delle pull
request (`build-desktop.yml`): ciò che si rilascia è ciò che la CI ha già costruito. Le build di
`main` passano tutte da qui (`build.yml` si occupa solo delle pull request), quindi non si costruisce
due volte.

| Job | Compito |
| --- | --- |
| `verify` | I test degli strumenti passano; sceglie versione e tag (automatica su `main`); per i tag manuali: formato giusto, **file di versione uguali al tag**, commit su `main` |
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
- **Icona dell'app:** sorgente vettoriale `apps/desktop/src-tauri/app-icon.svg` (una «V» a due toni su
  piastrella scura). Per rigenerare tutti i formati (`icon.ico` con 16–256 px, `icon.icns`, PNG),
  esporta l'SVG in PNG 1024×1024 e lancia `pnpm tauri icon <file.png>` in `apps/desktop`, poi copia
  in `src-tauri/icons/` solo i file elencati in `tauri.conf.json`. La stessa «V» è nel
  `favicon.svg`, nella barra laterale e nella grafica degli installer.
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
