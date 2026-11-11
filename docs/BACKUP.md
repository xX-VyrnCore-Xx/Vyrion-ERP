# Backup e ripristino

> **Stato: progettato, non implementato (milestone 10).** Oggi non esiste alcun backup automatico.
> Fino alla M10 usare la procedura manuale in fondo al documento.

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

## Dashboard (M10)

Ultimo backup, stato, dimensioni, errori, storico e ripristino guidato, riservati agli
amministratori. I dati mostrati provengono dal registro reale delle esecuzioni.

## Procedura manuale provvisoria

Backup, da `infra/` sul server:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > vyrion-$(date +%F).dump
```

Ripristino su un database vuoto:

```bash
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < vyrion-AAAA-MM-GG.dump
```

Il file prodotto **non è cifrato**: va conservato su un supporto cifrato e copiato anche fuori dal
server. Provare il ripristino su un ambiente di test prima di farvi affidamento.
