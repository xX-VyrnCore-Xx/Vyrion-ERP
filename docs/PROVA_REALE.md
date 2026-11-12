# Lista di controllo per la prova reale

Serve a verificare sull'app **installata** ciò che i test automatici non possono provare: il
database cifrato reale (SQLCipher), il guscio Tauri, gli installer e l'aggiornamento automatico.
Finora è provata la logica (test automatici) e la compilazione (CI); **qui si prova il programma
vero**. Spunta ogni riga e annota cosa vedi quando non coincide.

> Usa dati di prova, **non dati reali**, finché non hai finito. Tutte le cifre fiscali vanno poi
> fatte verificare dal commercialista e dal consulente del lavoro.

**Versione provata:** ______ · **Sistema:** Windows ☐ macOS ☐ · **Data:** ______

---

## 1. Installazione

**Windows**
- [ ] Il file `Vyrion-ERP_<versione>_Windows-x64-Setup.exe` si scarica. Controllo l'integrità con `SHA256SUMS.txt`.
- [ ] SmartScreen può avvisare (la firma non è di un'autorità riconosciuta): è atteso. Annoto il testo esatto.
- [ ] Il wizard è in italiano: licenza, cartella, fine. Il banner laterale mostra «Vyrion ERP · ERP · CRM · IT» con le tre righe.
- [ ] Non chiede i permessi di amministratore (installazione per utente).
- [ ] Alla fine chiede se avviare Vyrion ERP all'accesso a Windows (risposta «No» di prova).
- [ ] L'app parte; compare l'icona nella barra delle applicazioni.

**macOS (Apple Silicon)**
- [ ] Il `.dmg` si apre. La finestra mostra il titolo, la freccia e due icone (app e Applicazioni) **allineate ai riquadri**. Annoto se sono spostate.
- [ ] Trascino l'app in Applicazioni.
- [ ] Al primo avvio macOS può dire «non verificata» o «danneggiata»: è atteso (non notarizzata). Risolvo con *Impostazioni di Sistema → Privacy e sicurezza → Apri comunque* oppure con il comando `xattr` riportato nel disco.

## 2. Primo avvio e database cifrato

- [ ] Impostazioni → **Profilo e azienda**: compilo ragione sociale, forma giuridica e regime (**ordinario**, per provare l'IVA) con dati finti. Senza questi dati i documenti non si salvano.
- [ ] Impostazioni → **Dati e backup** indica l'archivio locale come cifrato.
- [ ] Creo 2–3 anagrafiche, chiudo l'app (anche dal tray: «Esci definitivamente») e la riapro: **i dati ci sono**.
- [ ] Riavvio il computer e riapro: i dati ci sono ancora e non viene chiesta nessuna password inattesa.
- [ ] (Facoltativo, per chi sa farlo) Il file del database, aperto con un editor di testo, **non** è leggibile in chiaro.

## 3. Backup e ripristino (Impostazioni → Dati e backup)

- [ ] Creo un backup cifrato e scelgo dove salvarlo: il file viene scritto.
- [ ] Controllo l'integrità: esito positivo.
- [ ] Aggiungo un dato nuovo, poi **ripristino** il backup: il dato nuovo sparisce, quelli precedenti restano.
- [ ] Provo un file di backup manomesso (cambio un byte): mi aspetto che il ripristino lo **rifiuti** con un messaggio chiaro senza toccare i dati attuali. Annoto cosa succede davvero: è un controllo che non ho potuto provare sull'app installata.

## 4. Aggiornamento automatico

- [ ] Impostazioni → **Aggiornamenti** mostra la versione installata.
- [ ] Da una versione **più vecchia** installata: «Controlla» trova la nuova, la scarica e la installa con un clic; l'app riparte alla versione nuova **con i dati intatti**.
- [ ] Annoto i tempi e se Windows/macOS chiedono conferme.
- [ ] Con rete assente il controllo non si blocca e dà un messaggio comprensibile.

## 5. Funzioni nuove (con numeri da controllare)

**Fattura con cassa e ritenuta** — Documenti → Fatture → nuova: cliente finto, riga 1 × 1.000,00 € IVA 22%, cassa 4%, ritenuta 20%.
- [ ] Totale documento **1.268,80 €**, ritenuta **208,00 €**, netto da incassare **1.060,80 €**.
- [ ] Emetto: numero progressivo assegnato, documento non più modificabile.
- [ ] Il PDF si scarica e riporta cassa, ritenuta e «NETTO DA INCASSARE».

**Registri IVA e liquidazione** — Report → Registri IVA e liquidazione (con la fattura di vendita di 1.000 € e un acquisto di 400 € + IVA 22%, emessi nello stesso mese).
- [ ] Registro vendite: IVA 220,00 €. Registro acquisti: IVA 88,00 € e protocollo 1.
- [ ] Liquidazione del periodo: IVA da versare **132,00 €**.
- [ ] «Registra la liquidazione» crea la scrittura in prima nota; annullarla la storna.

**Fattura in valuta** — nuova fattura, Valuta `USD`, Cambio `1,1`, riga 1 × 1.000,00 (IVA 22%).
- [ ] Totale **1.220,00 USD** e controvalore in euro **1.109,09 €**.
- [ ] Senza cambio il documento non si salva.
- [ ] Incasso in valuta: indico 1.220,00 USD e, come euro effettivi, 1.120,00 € → in prima nota compare un **utile su cambi di 10,91 €** (conto 420) e il credito si azzera.
- [ ] Il PDF stampa gli importi in USD e la riga «Controvalore in euro».

**Presenze e buste paga** — Personale → Presenze e buste paga. Dipendente di prova: lordo 2.000,00 €, contributi dipendente 10%, azienda 30%, ritenuta 20%.
- [ ] Importo un CSV del timbratore (colonne: Dipendente, Data, Entrata, Uscita, Pausa) con 2–3 giorni: ore lavorate corrette; reimportando non si creano doppioni.
- [ ] «Genera le buste paga mancanti»: lordo 2.000,00 €, netto **1.440,00 €**, costo azienda **2.600,00 €**.
- [ ] «Registra» scrive in prima nota; «Paga» chiude il debito verso il dipendente.
- [ ] Una busta paga registrata non si modifica; eliminarla (se non pagata) storna la scrittura.

**Esportazione per il commercialista** — Report → Esportazione per il commercialista.
- [ ] Il pulsante «Scarica il pacchetto (.zip)» apre il dialogo di salvataggio del sistema e salva `commercialista_<anno>.zip`.
- [ ] Il file **si apre** con lo strumento del sistema (Esplora risorse / Finder) e contiene `LEGGIMI.txt` e i CSV.
- [ ] Aprendo la prima nota in Excel: caratteri accentati corretti, colonne separate, importi con la virgola, **totale Dare = totale Avere**.

## 6. Uso quotidiano e prestazioni

- [ ] Chiudo la finestra: l'app resta nel tray (se così è impostato) e si riapre dal tray.
- [ ] Una seconda esecuzione dell'app **non** apre una seconda finestra ma porta in primo piano la prima.
- [ ] Con circa 1.000+ record (importo un CSV di anagrafiche): ricerca globale e liste restano fluide. Annoto i tempi percepiti.
- [ ] Il consumo di CPU a riposo resta basso (Gestione attività / Monitoraggio Attività). Annoto il valore.
- [ ] Su un portatile, nessun consumo anomalo di batteria con l'app aperta ma inattiva per 30 minuti.

## 7. Disinstallazione

- [ ] **Windows:** Impostazioni → App → Disinstalla. Chiede se eliminare anche i dati dell'applicazione: provo prima **No** (i dati restano), poi reinstallo e controllo che ci siano ancora.
- [ ] **macOS:** trascino l'app nel Cestino; i dati restano nella cartella dell'app.

---

## Cosa annotare quando qualcosa non torna

Versione e sistema operativo · cosa ho fatto, passo per passo · cosa mi aspettavo · cosa è successo
(testo esatto dei messaggi, schermata se possibile) · se si ripete.

## Cosa questa lista NON copre

Notarizzazione macOS e firma Windows con certificato riconosciuto (richiedono account e
certificati a pagamento), prove con più utenti o con il server, test di sicurezza esterni, e la
**correttezza fiscale** delle cifre, che resta al commercialista e al consulente del lavoro.
