# Backup service: pg_dump -> age -> checksum -> rotation, on a schedule. No secrets in the image.
# Based on the same PostgreSQL image as the server, so pg_dump always matches its version.
FROM postgres:18-alpine
RUN apk add --no-cache bash jq age coreutils findutils tzdata
COPY *.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh && mkdir /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT ["/opt/backup/scheduler.sh"]
