# Moduli

**Nessun modulo gestionale è ancora implementato.** Questo documento definisce l'ambito previsto.
Un modulo compare nell'interfaccia solo quando ha un'implementazione reale e testata.

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
