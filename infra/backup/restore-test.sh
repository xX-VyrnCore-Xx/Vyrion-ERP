#!/usr/bin/env bash
# The proof a backup is usable: decrypt the newest one, restore it into a throwaway database
# and compare it with the live one. Needs the private key, which lives offline.
#   restore-test.sh <age-identity-file>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

[ "$#" -eq 1 ] || { echo "usage: restore-test.sh <age-identity-file>" >&2; exit 2; }
identity="$1"
started="$(now)"
# shellcheck disable=SC2012
file="$(ls -1t "$BACKUP_DIR"/daily/vyrion-*.dump.age 2>/dev/null | head -n 1 || true)"
[ -n "$file" ] || { record_run restore_test false "" 0 "" "$started" "no backups found"; echo "no backups found" >&2; exit 1; }

scratch="vyrion_restore_test_$$"
admin_db="${PGADMIN_DB:-postgres}"
cleanup() { psql -d "$admin_db" -qAtc "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { record_run restore_test false "daily/$(basename "$file")" 0 "" "$started" "$1"; echo "restore test failed: $1" >&2; exit 1; }

psql -d "$admin_db" -qAtc "CREATE DATABASE \"$scratch\"" || fail "cannot create the scratch database"
"$here/restore.sh" "$file" "$identity" "$scratch" >/dev/null || fail "the restore itself failed"

# The restored copy must have the same tables and the same schema revision as the live one.
count_tables() { psql -d "$1" -qAtc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"; }
revision() { psql -d "$1" -qAtc "SELECT version_num FROM alembic_version" 2>/dev/null || echo none; }
live="${PGDATABASE:?PGDATABASE is required}"
[ "$(count_tables "$scratch")" = "$(count_tables "$live")" ] || fail "the number of tables differs from the live database"
[ "$(revision "$scratch")" = "$(revision "$live")" ] || fail "the schema revision differs from the live database"

record_run restore_test true "daily/$(basename "$file")" "$(file_size "$file")" "$(digest "$file")" "$started"
echo "restore test ok: $(basename "$file")"
