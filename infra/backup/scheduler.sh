#!/usr/bin/env bash
# Container entry point: one backup a day at BACKUP_AT (UTC, HH:MM), then an integrity check.
# Also runs at start when the newest backup is older than a day, so a server that was off at
# the scheduled time does not stay unprotected.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

BACKUP_AT="${BACKUP_AT:-02:30}"
run() { "$here/backup.sh" || echo "backup failed, next attempt at $BACKUP_AT" >&2; "$here/verify.sh" || true; }

newest="$(find "$BACKUP_DIR/daily" -name 'vyrion-*.dump.age' -mmin -1440 2>/dev/null | head -n 1)"
[ -n "$newest" ] || run

while true; do
  target="$(date -u -d "today $BACKUP_AT" +%s)"
  nowts="$(date -u +%s)"
  [ "$target" -gt "$nowts" ] || target="$(date -u -d "tomorrow $BACKUP_AT" +%s)"
  sleep "$((target - nowts))"
  run
done
