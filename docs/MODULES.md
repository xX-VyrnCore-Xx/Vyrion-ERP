# Moduli

I moduli CRM, ERP e IT hanno una **prima implementazione reale, locale e testata** nell'app
desktop (regole nel client, dati nel database SQLite cifrato). Questo documento indica, per
ciascun modulo, cosa c'è e cosa **non** c'è ancora. Un modulo compare nell'interfaccia solo quando
ha un'implementazione reale e testata.

## Cosa c'è oggi

| Area | Implementato | Non ancora |
| --- | --- | --- |
| **Anagrafiche** | Clienti, fornitori, partner, potenziali clienti; contatti; partita IVA, codice fiscale e IBAN validati per checksum; **importazione da CSV** (mappatura colonne, controllo riga per riga, salto dei già presenti) su tutte le entità non contabili; **ricerca e unione dei duplicati** (partita IVA, codice fiscale, email, nome), con blocco se il duplicato ha documenti emessi | Fusione automatica con regole su campi in conflitto (oggi si completano solo i campi vuoti) |
| **Pipeline** | Fasi configurabili, opportunità, vista a colonne, valore ponderato, data di chiusura automatica | Trascinamento con il mouse (si sposta con un menu) |
| **Comunicazioni, agenda, attività** | Registro di chiamate/email/incontri (inseriti a mano), appuntamenti, attività con scadenza, calendario mensile; **promemoria** (appuntamenti «X minuti prima», attività «ricordamelo il») tra gli avvisi dell'app; **esportazione e importazione .ics** (Outlook, Google, Apple; l'importazione non crea doppioni) | **Integrazione email**, sincronizzazione continua con calendari esterni (oggi si scambia un file .ics), notifiche di sistema ad app chiusa, eventi ricorrenti espansi |
| **Contratti e assistenza** | Contratti con preavviso di disdetta; ticket numerati per anno con interventi; **fatturazione delle ore** (bozza di fattura per cliente, una riga per ticket in ore, tariffa dal cliente, arrotondamento, interventi bloccati e non fatturabili due volte) | Ore dei ticket per contratto con monte ore |
| **Documenti** | Preventivi → ordini → fatture; note di credito; fatture di acquisto; numerazione senza buchi e in ordine di data; totali IVA per aliquota; bollo; regime forfettario/ordinario; documenti emessi immutabili; **cassa previdenziale** (aggiunta alla base IVA), **ritenuta d'acconto** (su compensi e cassa, con quota imponibile), **split payment** e **netto da incassare/pagare** (scadenzario, incassi e registrazioni contabili lo usano), con riepilogo IVA che tiene fuori l'IVA in split e report delle ritenute subite e operate; **PDF** di ogni documento (intestazione azienda, destinatario, righe con paginazione, riepilogo IVA, bollo, scadenza, IBAN, note e dicitura del regime forfettario; per le fatture è una *copia di cortesia*) | **XML FatturaPA e invio SDI**, fatture multi-valuta, ritenuta su più aliquote o per più percipienti, cassa con aliquota IVA propria |
| **Contabilità** | Piano dei conti, prima nota in partita doppia (quadratura obbligatoria, immutabile, storno), registrazioni automatiche da fatture e pagamenti, bilancio di verifica, conto economico; **chiusura dell'esercizio** (risultato a patrimonio netto, blocco dell'anno, riapertura dell'ultimo chiuso) e stato patrimoniale gestionale; **cespiti e ammortamenti** a quote costanti (metà aliquota il primo anno, capitalizzazione dal costo, registrazione annuale una sola volta) | Bilancio civilistico (schema del Codice civile), ammortamento pro rata nell'anno di dismissione, cespiti con più aliquote, riconciliazione con flussi bancari automatici (PSD2) |
| **Scadenze e pagamenti** | Scadenzario clienti/fornitori con fasce di scaduto, incassi e pagamenti parziali, storno dei pagamenti; **riconciliazione bancaria** da estratto conto CSV (importazione senza doppioni, abbinamento per importo, direzione, data e numero documento) | Flussi bancari automatici (PSD2) |
| **Magazzino** | Prodotti e servizi, movimenti con segno, giacenza non negativa, scorta minima, movimenti automatici dalle fatture; **più magazzini** (giacenza e vendite controllate per magazzino, trasferimenti che non cambiano il valore); **lotti** con scadenza (vendite in ordine di scadenza, acquisti caricati in un lotto col numero del documento, avvisi su lotti scaduti o in scadenza); **valore al costo medio ponderato** | Matricole come entità a sé (si usa un lotto per pezzo); inventario fisico guidato; FIFO/LIFO a strati |
| **Personale e progetti** | Anagrafica, ferie/assenze senza sovrapposizioni, progetti, ore, costo del lavoro e valore fatturabile; **presenze** (entrata/uscita/pausa, import CSV dal timbratore, ore attese con festivi nazionali e assenze approvate, straordinario); **buste paga come prospetto gestionale** (lordo, contributi e ritenuta con le aliquote indicate, netto, costo azienda), registrazione in prima nota e pagamento | Busta paga ufficiale (scaglioni IRPEF, detrazioni, addizionali, TFR, contratti collettivi, 13ª/14ª), UniEmens, CU, integrazione diretta con il timbratore |
| **Report** | Conto economico, riepilogo IVA, bilancio di verifica, progetti, esportazione CSV; **registri IVA** vendite e acquisti (protocollo progressivo degli acquisti, totali per aliquota, IVA in split a parte, CSV) e **liquidazione periodica** mensile/trimestrale (credito e debito sotto € 25,82 riportati, interessi 1% sui trimestri 1–3, scadenze, acconto di dicembre col metodo storico, registrazione in prima nota su «Erario c/IVA») | Stampa dei registri con numerazione di pagina e vidimazione, corrispettivi, liquidazione annuale e dichiarazione, acconto con metodi previsionale/analitico, versamento F24 |
| **IT** | Inventario asset, reti con controllo di sovrapposizione e appartenenza degli IP, peer WireGuard (solo chiave pubblica), account (senza password), licenze, backup (job + esecuzioni registrate), eventi di sicurezza, controlli TCP reali, risorse di questo computer, documentazione tecnica | Agenti di monitoraggio remoti, integrazione Proxmox/NAS, scansione di rete |
| **Trasversali** | Panoramica con indicatori reali e personalizzabile, notifiche calcolate dai dati, ricerca globale, storico delle modifiche, allegati, backup e ripristino cifrati | Permessi per record; più utenti locali; numerazione fiscale assegnata dal server (vedi i limiti in [SYNC_ENGINE.md](SYNC_ENGINE.md)) |

> **Contabilità gestionale ≠ adempimenti fiscali.** Quanto sopra produce dati gestionali. Registri
> IVA, liquidazioni e dichiarazioni restano di competenza del commercialista.

## Ambito originario (riferimento)

## Struttura di un modulo

```
backend/app/modules/<modulo>/
  models.py     Tabelle SQLAlchemy
  schemas.py    Schemi Pydantic (input/output)
  service.py    Regole di business
  router.py     Endpoint REST con controllo dei permessi
  sync.py       Politica di sincronizzazione delle entità
```

Ogni modulo dichiara i propri permessi nel formato `<modulo>.<risorsa>:<azione>`, con azioni
`view`, `create`, `update`, `delete`, `export`, `approve`, `admin`.

## ERP — milestone 7

| Modulo | Contenuto |
| --- | --- |
| Contabilità | Piano dei conti, prima nota, movimenti |
| Fatturazione | Fatture, note di credito, IVA, bollo |
| Tesoreria | Entrate, uscite, scadenze, pagamenti |
| Report | Bilanci, report finanziari, analisi economiche |
| Acquisti | Fornitori, ordini di acquisto |
| Vendite | Preventivi, ordini |
| Magazzino | Prodotti, servizi, inventario, movimenti |
| Personale | Dipendenti |
| Progetti | Progetti aziendali |
| Documenti | Documenti e contratti |

### Fiscalità italiana

- L'azienda configura **forma giuridica** (ditta individuale, SRL, SRLS, SPA) e **regime fiscale**
  (forfettario, ordinario). Sono attributi distinti: il forfettario è ammesso solo per persone
  fisiche. Vedi [DATABASE.md](DATABASE.md).
- **Contabilità gestionale ≠ adempimenti fiscali.** Vyrion ERP produce dati gestionali. Registri
  IVA, liquidazioni, bilancio civilistico e dichiarazioni restano di competenza del commercialista;
  ogni vista gestionale lo indica chiaramente e non viene presentata come registro fiscalmente valido.
- Predisposizioni: generazione XML **FatturaPA**, invio/ricezione tramite **SDI** attraverso un
  intermediario accreditato, esportazioni per il commercialista.
- Le regole fiscali cambiano: aliquote, soglie e codici sono dati configurabili, non costanti nel
  codice, e vanno verificati con il commercialista prima dell'uso in produzione.

## CRM — milestone 8

| Modulo | Contenuto |
| --- | --- |
| Anagrafiche | Clienti, fornitori, partner, contatti |
| Comunicazioni | Storico, integrazione email |
| Pipeline | Opportunità, trattative, fasi |
| Offerte | Preventivi, contratti |
| Agenda | Calendario, appuntamenti, attività, promemoria |
| Assistenza | Ticket clienti |
| Statistiche | Indicatori commerciali |

Le anagrafiche di clienti e fornitori sono **uniche** e condivise tra ERP e CRM.

## IT Management — milestone 9

| Modulo | Contenuto |
| --- | --- |
| Inventario | Hardware, computer Windows/macOS, server, macchine virtuali |
| Rete | Reti, VPN, inventario indirizzi IP, NAS |
| Account e licenze | Account IT, licenze, abbonamenti, scadenze |
| Assistenza | Ticket interni, interventi tecnici |
| Monitoraggio | Risorse, backup, sicurezza, storico eventi, notifiche |
| Documentazione | Documentazione tecnica |

Il monitoraggio usa dati raccolti realmente (agenti o interrogazioni verso Proxmox, NAS e server);
finché una fonte non è collegata, il relativo widget mostra "non configurato", non valori d'esempio.

## Trasversali

| Funzione | Milestone |
| --- | --- |
| Utenti, ruoli, permessi, audit, accesso e 2FA | 4 ✅ |
| Dashboard personalizzabile, ricerca globale, notifiche | 5 |
| Sincronizzazione offline | 6 |
| Backup e ripristino guidato | 10 |
