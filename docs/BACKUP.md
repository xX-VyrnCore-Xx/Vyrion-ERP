# Backup e ripristino

> **Stato: implementato (milestone 10)** per il database PostgreSQL: servizio `backup` nello stack
> Compose, cifratura `age`, rotazione, controllo di integrità e prova di ripristino, con test
> end-to-end in CI. Cosa **non** è coperto è elencato in «Limiti».

## Obiettivi

| Parametro | Obiettivo iniziale |
| --- | --- |
| RPO (perdita massima di dati) | 24 ore; 1 ora con archiviazione WAL |
| RTO (tempo di ripristino) | 4 ore |
| Copie | Regola 3-2-1: tre copie, due supporti, una fuori sede |

## Cosa viene salvato

| Dato | Metodo | Frequenza |
| --- | --- | --- |
| PostgreSQL | `pg_dump` formato custom; in seguito WAL per ripristino a un istante | Giornaliera |
| Documenti e allegati | Copia incrementale dal NAS | Giornaliera |
| Configurazioni | `infra/` senza segreti; segreti in archivio cifrato separato | A ogni modifica |
| **Chiave di cifratura** (`ENCRYPTION_KEYS`) | Copia cifrata **fuori dal server e dal NAS** | A ogni modifica |
| Stato della sincronizzazione | Incluso nel dump PostgreSQL | Giornaliera |

## Destinazioni

1. **NAS aziendale** — copia primaria.
2. **Copia indipendente dal NAS** — secondo supporto o destinazione fuori sede cifrata. Un guasto,
   un furto o un ransomware che colpisce il NAS non deve compromettere tutti i backup.

## Garanzie

| Garanzia | Meccanismo |
| --- | --- |
| Cifratura | Lato server, prima dell'invio, con chiave pubblica; la chiave privata è custodita offline |
| Integrità | Checksum SHA-256 registrato e riverificato dopo la copia |
| Rotazione | 7 giornalieri, 4 settimanali, 12 mensili |
| Ripristinabilità | Test periodico automatico: ripristino in un database temporaneo e controlli di coerenza |
| Osservabilità | Ogni esecuzione registra esito, durata, dimensione ed errori |

Un backup non verificato da un ripristino riuscito non è considerato valido.

## Come funziona

Il servizio `backup` (`infra/backup/`, immagine Alpine con `pg_dump`, `age` e `jq`) parte con lo
stack e:

1. alla prima partenza, o se l'ultimo backup ha più di 24 ore, ne esegue subito uno;
2. ogni giorno all'ora `BACKUP_AT` (UTC, default 02:30) esegue `backup.sh`, poi `verify.sh`.

`backup.sh` esegue `pg_dump --format=custom`, cifra al volo con `age` usando **solo la chiave
pubblica** (`BACKUP_AGE_RECIPIENT`), scrive il file in `daily/`, ne calcola lo SHA-256 e lo
riverifica. Un `pg_dump` fallito non lascia file (nessun backup «vuoto»). La domenica la copia va
anche in `weekly/`, il primo del mese in `monthly/`. Con `BACKUP_COPY_DIR` ogni backup viene copiato
anche in una seconda destinazione e verificato lì. Ogni esecuzione aggiunge una riga a
`runs.ndjson` (esito, durata, dimensione, checksum, errore).

| Script | Funzione | Serve la chiave privata |
| --- | --- | --- |
| `backup.sh` | Dump cifrato, checksum, rotazione, seconda copia | No |
| `verify.sh` | Rilegge checksum e intestazione di **tutti** i backup | No |
| `restore.sh <file> <chiave> <db>` | Ripristina in un database esistente (lo svuota) | Sì |
| `restore-test.sh <chiave>` | Ripristina l'ultimo backup in un database temporaneo e lo confronta con quello vivo (tabelle e revisione dello schema) | Sì |

## Configurazione

1. Su un computer **fidato** (non sul server): `age-keygen -o vyrion-backup-key.txt`.
2. Metti la riga `Public key: age1…` in `infra/.env` come `BACKUP_AGE_RECIPIENT`.
3. Custodisci `vyrion-backup-key.txt` **offline** (gestore di password e copia su carta). Senza di
   essa i backup non si aprono; con essa chi ruba un backup legge tutto.
4. Per la regola 3-2-1 monta una seconda destinazione (`BACKUP_COPY_PATH` sull'host e
   `BACKUP_COPY_DIR` nel container). Una cartella sullo stesso disco **non** è una seconda copia.

## Stato dei backup via API

`GET /api/v1/backups` (permesso `core.backups:view`, riservato agli amministratori) restituisce
ultimo backup, ultimo controllo, ultima prova di ripristino, i file conservati e lo storico, letti
dal registro reale del servizio. Lo usa il programma di amministrazione del server (non l'app
desktop). Il volume è montato in **sola lettura** nel backend: l'API non può alterare né
cancellare i backup. Il server risulta «non aggiornato» se non c'è un backup riuscito da più di
36 ore.

## Prova di ripristino

Il controllo automatico giornaliero verifica integrità (checksum, intestazione cifrata) ma **non può
decifrare**: la chiave privata non è sul server. La prova completa si fa con la chiave, a mano o
dal computer che la custodisce, almeno ogni mese e dopo ogni aggiornamento importante:

```bash
docker compose exec backup sh -c 'cat > /tmp/key.txt'   # incolla la chiave privata, poi Ctrl-D
docker compose exec backup /opt/backup/restore-test.sh /tmp/key.txt
docker compose exec backup rm /tmp/key.txt
```

Ripristino reale su un database vuoto (sostituisci i nomi):

```bash
docker compose exec backup /opt/backup/restore.sh /backups/daily/vyrion-AAAAMMGGTHHMMSSZ.dump.age /tmp/key.txt vyrion_nuovo
```

Il test automatico in CI (`infra/backup/test.sh`) esegue l'intero ciclo con una chiave generata al
momento: backup, controllo, ripristino con confronto riga per riga, chiave sbagliata, file
manomesso, `pg_dump` fallito, seconda destinazione e rotazione.

## Limiti

- **`ENCRYPTION_KEYS` non è nel backup**: copiala a parte (vedi sopra). Il dump contiene i segreti
  2FA cifrati con quella chiave.
- Non c'è archiviazione WAL: l'RPO reale è 24 ore (l'RPO di 1 ora resta un obiettivo).
- Il server non conserva allegati come file: gli allegati sono record sincronizzati e stanno nel dump.
- I backup locali dell'app desktop (Impostazioni → Dati) sono un'altra cosa e restano separati.
