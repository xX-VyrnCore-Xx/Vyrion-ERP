# Backup service: pg_dump -> age -> checksum -> rotation, on a schedule. No secrets in the image.
FROM alpine:3.22
RUN apk add --no-cache bash jq age coreutils findutils postgresql18-client tzdata
COPY *.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh && adduser -D -u 10001 backup && mkdir /backups && chown backup /backups
USER backup
ENTRYPOINT ["/opt/backup/scheduler.sh"]
