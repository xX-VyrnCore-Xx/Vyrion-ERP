#!/usr/bin/env bash
# Integrity check of every stored backup: checksum and encryption header. Needs no key.
# For the full proof (decrypt + restore) use restore-test.sh.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

started="$(now)"
checked=0 bad=0 detail=""
for file in "$BACKUP_DIR"/daily/vyrion-*.dump.age "$BACKUP_DIR"/weekly/vyrion-*.dump.age "$BACKUP_DIR"/monthly/vyrion-*.dump.age; do
  [ -e "$file" ] || continue
  checked=$((checked + 1))
  if ! checksum_ok "$file" || ! looks_encrypted "$file"; then
    bad=$((bad + 1)); detail="$detail $(basename "$file")"
  fi
done
if [ "$checked" -eq 0 ]; then
  record_run verify false "" 0 "" "$started" "no backups found"
  echo "no backups to verify" >&2; exit 1
fi
if [ "$bad" -gt 0 ]; then
  record_run verify false "" 0 "" "$started" "$bad of $checked backups are damaged:$detail"
  echo "$bad of $checked backups are damaged:$detail" >&2; exit 1
fi
record_run verify true "" 0 "" "$started"
echo "verified $checked backups"
