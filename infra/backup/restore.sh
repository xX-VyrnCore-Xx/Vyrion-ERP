#!/usr/bin/env bash
# Restores an encrypted backup into an EXISTING database.
#   restore.sh <backup.dump.age> <age-identity-file> <target-database>
# The target database is emptied first (--clean): never point it at production by accident.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

[ "$#" -eq 3 ] || { echo "usage: restore.sh <backup.dump.age> <age-identity-file> <target-database>" >&2; exit 2; }
file="$1" identity="$2" target="$3"
[ -f "$file" ] || { echo "no such backup: $file" >&2; exit 2; }
[ -f "$identity" ] || { echo "no such identity file: $identity" >&2; exit 2; }
checksum_ok "$file" || { echo "the checksum does not match: refusing to restore a damaged backup" >&2; exit 1; }

age --decrypt --identity "$identity" "$file" |
  pg_restore --dbname "$target" --no-owner --clean --if-exists --exit-on-error
echo "restored $(basename "$file") into $target"
