#!/usr/bin/env bash
# Encrypted PostgreSQL backup: pg_dump -> age (public key only) -> checksum -> rotation.
#
#   PG* variables       connection (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)
#   BACKUP_AGE_RECIPIENT  age public key (age1...); the private key is NOT on this machine
#   BACKUP_DIR          primary destination (default /backups)
#   BACKUP_COPY_DIR     optional second destination (another disk or share)
#   KEEP_DAILY/WEEKLY/MONTHLY   retention (default 7/4/12)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required (an age public key)}"
case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must be an age public key" >&2; exit 2 ;; esac
KEEP_DAILY="${KEEP_DAILY:-7}" KEEP_WEEKLY="${KEEP_WEEKLY:-4}" KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

started="$(now)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"
tmp="$BACKUP_DIR/.partial-$stamp"
final="$BACKUP_DIR/daily/vyrion-$stamp.dump.age"

fail() {
  rm -f "$tmp"
  record_run backup false "" 0 "" "$started" "$1"
  echo "backup failed: $1" >&2
  exit 1
}

# `pipefail` makes a failing pg_dump fail the whole pipeline: no half-empty "backup".
if ! pg_dump --format=custom --no-owner 2>"$tmp.err" | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp"; then
  fail "pg_dump or encryption failed: $(tr '\n' ' ' <"$tmp.err" | head -c 300)"
fi
rm -f "$tmp.err"
[ -s "$tmp" ] || fail "the backup file is empty"
looks_encrypted "$tmp" || fail "the backup file is not encrypted"

mv "$tmp" "$final"
sha="$(digest "$final")"
printf '%s  %s\n' "$sha" "$(basename "$final")" >"$final.sha256"
checksum_ok "$final" || fail "the checksum does not match right after writing"

# Weekly (Sunday) and monthly (1st) copies are the long-term history.
[ "$(date -u +%u)" = 7 ] && cp -p "$final" "$final.sha256" "$BACKUP_DIR/weekly/"
[ "$(date -u +%d)" = 01 ] && cp -p "$final" "$final.sha256" "$BACKUP_DIR/monthly/"

# Second destination: copied, then verified there. A failed copy fails the run.
if [ -n "${BACKUP_COPY_DIR:-}" ]; then
  mkdir -p "$BACKUP_COPY_DIR"
  cp -p "$final" "$final.sha256" "$BACKUP_COPY_DIR/"
  copied="$BACKUP_COPY_DIR/$(basename "$final")"
  checksum_ok "$copied" || fail "the copy in BACKUP_COPY_DIR is corrupt"
fi

prune() { # dir keep
  # shellcheck disable=SC2012
  { ls -1t "$1"/vyrion-*.dump.age 2>/dev/null || true; } | tail -n +"$(($2 + 1))" | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"
[ -z "${BACKUP_COPY_DIR:-}" ] || prune "$BACKUP_COPY_DIR" "$((KEEP_DAILY + KEEP_WEEKLY + KEEP_MONTHLY))"

record_run backup true "daily/$(basename "$final")" "$(file_size "$final")" "$sha" "$started"
echo "backup ok: $final"
