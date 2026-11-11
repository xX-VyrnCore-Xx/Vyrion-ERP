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
| Furto o smarrimento di una postazione | Database locale cifrato, revoca sessioni dal server (M4–M6) |
| Credenziali deboli o rubate | Argon2id, 2FA, blocco account, rate limiting (M4) |
| Abuso da utente interno | RBAC lato server, audit log (M4) |
| Dipendenze vulnerabili | Audit automatico in CI, Dependabot |
| Segreti nel repository | `.gitignore`, nessun default per i segreti, revisione delle PR |

## In vigore

- **Nessun segreto predefinito.** Il backend non parte senza `VYRION_DATABASE_URL` e
  `VYRION_REDIS_URL`; Compose rifiuta l'avvio se mancano password o indirizzo di bind.
- **Esposizione di rete minima.** Solo il proxy pubblica una porta, legata a `VYRION_BIND_ADDRESS`
  (indirizzo WireGuard). PostgreSQL, Redis e backend vivono su una rete Docker interna.
- **Container ristretti.** Backend con utente non privilegiato, filesystem in sola lettura,
  capability rimosse, `no-new-privileges`. Redis richiede password.
- **CORS ristretto** alle origini dell'app desktop.
- **Documentazione API interattiva disattivata in produzione.**
- **Nessuna fuga di dettagli.** Gli errori delle probe finiscono nei log, non nelle risposte.
- **Client:** HTTPS obbligatorio per l'indirizzo del server (HTTP ammesso solo su loopback),
  rifiuto di URL con credenziali, Content Security Policy restrittiva, capability Tauri minime.
- **Catena di fornitura:** lockfile versionati, `pip-audit` e `pnpm audit` in CI.

## Pianificato

| Controllo | Milestone |
| --- | --- |
| Password con Argon2id | 4 |
| 2FA TOTP con codici di recupero | 4 |
| Sessioni lato server, refresh token a rotazione con rilevamento del riuso | 4 |
| Protezione brute force, blocco account, rate limiting su Redis | 4 |
| Revoca sessioni e disconnessione da tutti i dispositivi | 4 |
| RBAC con permessi per modulo, azione e record | 4 |
| Audit log e storico accessi | 4 |
| Cifratura applicativa dei dati sensibili | 4 |
| Token nel portachiavi di sistema, non nel webview | 5 |
| SQLite locale cifrato | 6 |
| Backup cifrati con verifica d'integrità | 10 |
| Analisi statica di sicurezza e scansione dei segreti in CI | 11 |
| Firma del codice, notarizzazione macOS, aggiornamenti firmati | 12 |

## Regole per chi sviluppa

1. Mai inserire nel repository credenziali, certificati privati, chiavi o file `.env`.
2. Ogni endpoint verifica autenticazione e permessi nel backend; l'interfaccia non è un controllo.
3. Ogni input è validato da schemi Pydantic; le query usano sempre parametri.
4. I log non contengono password, token o dati personali non necessari.
5. Ogni nuova dipendenza va motivata e deve essere mantenuta attivamente.

## Segreti

| Segreto | Dove risiede |
| --- | --- |
| Password PostgreSQL e Redis | `infra/.env` sul server, permessi `600`, fuori dal repository |
| Chiavi di firma e certificati | Segreti cifrati di GitHub Actions (M12) |
| Chiavi di cifratura dei backup | Custodite offline, separate dai backup (M10) |
