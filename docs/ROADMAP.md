# Roadmap

Versionamento [Semantic Versioning](https://semver.org/lang/it/). Le date non sono fissate: ogni
fase si chiude al raggiungimento dei criteri, non a calendario.

| Fase | Versioni | Contenuto | Milestone |
| --- | --- | --- | --- |
| **Alpha** | `0.1.0-alpha.N` | Fondamenta: ambiente, database, autenticazione, shell desktop, sincronizzazione | 1–6 |
| **Beta** | `0.x.0-beta.N` | Moduli ERP, CRM e IT completi; backup | 7–10 |
| **Release Candidate** | `1.0.0-rc.N` | Solo correzioni: test end-to-end, sicurezza, ripristino, prestazioni | 11 |
| **Stable** | `1.0.0` | Installatori firmati Windows e macOS, aggiornamento automatico | 12 |

## Criteri di passaggio

| Passaggio | Criteri |
| --- | --- |
| Alpha → Beta | Login con 2FA e RBAC operativi; sincronizzazione offline verificata dai test di conflitto |
| Beta → RC | Tutti i moduli implementati; backup con test di ripristino riuscito |
| RC → Stable | Nessun difetto bloccante; revisione di sicurezza; installatori firmati e notarizzati |

## Dopo la 1.0

- Fatturazione elettronica: generazione FatturaPA e integrazione SDI tramite intermediario.
- Esportazioni per il commercialista.
- Integrazione email nel CRM.
- Agenti di monitoraggio per postazioni e server.
- Ruoli personalizzati avanzati e autorizzazioni per singolo record estese a tutti i moduli.

## Stato

Versione corrente: `0.1.0-alpha.1`. Dettaglio in [PLAN.md](PLAN.md).
