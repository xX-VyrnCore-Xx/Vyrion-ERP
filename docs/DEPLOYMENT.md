# Deployment

Installazione dello stack server su **Ubuntu Server 24.04 LTS** (VM su Proxmox VE).

## Prerequisiti

| Requisito | Note |
| --- | --- |
| VM Ubuntu Server | Disco su storage locale affidabile di Proxmox (non su condivisione NAS) |
| Docker Engine + plugin Compose | Dal repository ufficiale Docker |
| WireGuard | Interfaccia `wg0` attiva sul server, con indirizzo fisso (es. `10.8.0.1`) |
| DNS interno o file hosts | Il nome del server (es. `erp.vyrncore.lan`) risolve all'indirizzo WireGuard |

## Installazione

```bash
git clone <repository> /opt/vyrion-erp
```

```bash
cd /opt/vyrion-erp/infra && cp .env.example .env && chmod 600 .env
```

Compila `.env`:

| Variabile | Valore |
| --- | --- |
| `VYRION_SERVER_NAME` | Nome usato dai client, es. `erp.vyrncore.lan` |
| `VYRION_BIND_ADDRESS` | Indirizzo del server su `wg0`. **Mai `0.0.0.0`** |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Generate con `openssl rand -hex 32` |
| `ENCRYPTION_KEYS` | Chiave che cifra i segreti nel database. `openssl rand -base64 32 \| tr '+/' '-_'`. **Conservane una copia fuori dal server** |

Avvio:

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

Il backend applica le migrazioni e sincronizza permessi e ruoli di sistema all'avvio. Tutti i
servizi devono risultare `healthy`.

## Primo amministratore

Il sistema parte senza utenti. Il primo amministratore principale si crea dal server, digitando la
password al terminale (non si passa mai da riga di comando né da variabile d'ambiente):

```bash
docker compose exec backend python -m app.cli create-admin --email nome@vyrncore.lan --name "Nome Cognome"
```

Il comando rifiuta di creare un secondo amministratore principale e una password debole. Gli altri
utenti si creano poi dall'applicazione: ognuno riceve un **token monouso** per scegliere la propria
password, che l'amministratore gli consegna in un canale fidato.

## Verifica

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./vyrion-root.crt
```

```bash
curl --cacert vyrion-root.crt https://erp.vyrncore.lan/api/v1/health/ready
```

Risposta attesa: HTTP 200 con `"status":"ok"`.

## Certificato HTTPS

Il proxy emette il certificato con una **CA locale** (Caddy `tls internal`). Perché i client si
fidino del server, il certificato radice `vyrion-root.crt` va installato su ogni postazione:

| Sistema | Procedura |
| --- | --- |
| Windows | `certutil -addstore -f Root vyrion-root.crt` (prompt amministratore) |
| macOS | Accesso Portachiavi → Sistema → importa → imposta "Fidati sempre" |

In alternativa si usa una CA aziendale: in `infra/Caddyfile` sostituire `tls internal` con
`tls /percorso/cert.pem /percorso/key.pem` e montare i file nel container. Le chiavi private non
vanno mai nel repository.

## Rete e firewall

- L'unica porta pubblicata è `443/tcp`, sull'indirizzo WireGuard.
- PostgreSQL, Redis e backend non pubblicano porte.
- Sul firewall del server consentire `443/tcp` solo dall'interfaccia `wg0`:

```bash
sudo ufw allow in on wg0 to any port 443 proto tcp
```

- Sul router/firewall perimetrale è inoltrata solo la porta UDP di WireGuard, nient'altro.

## Client

Dopo l'installazione dell'app, in **Impostazioni → Server aziendale** inserire
`https://erp.vyrncore.lan`. Con la VPN attiva lo stato diventa "Connesso".

## Aggiornamento

```bash
cd /opt/vyrion-erp && git pull
```

```bash
cd infra && docker compose up -d --build
```

Eseguire un backup del database prima di ogni aggiornamento che contiene migrazioni
(vedi [BACKUP.md](BACKUP.md)).

## Operazioni comuni

| Operazione | Comando (da `infra/`) |
| --- | --- |
| Log del backend | `docker compose logs -f backend` |
| Stato | `docker compose ps` |
| Riavvio di un servizio | `docker compose restart backend` |
| Arresto (i dati restano nei volumi) | `docker compose down` |

`docker compose down -v` **elimina i volumi, quindi il database**: non usarlo in produzione.

## Non ancora automatizzato

Backup, monitoraggio, montaggio del NAS e servizi di sincronizzazione e gestione documentale
arrivano con le milestone 6 e 10. Fino ad allora il backup del database va eseguito manualmente.
