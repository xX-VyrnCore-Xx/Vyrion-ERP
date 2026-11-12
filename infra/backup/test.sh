#!/usr/bin/env bash
# End-to-end test of the backup scripts against a real PostgreSQL (needs pg_dump, psql, age, jq).
# Connection comes from the PG* variables. PGDATABASE should be a scratch database: the test
# creates and drops a small table in it.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export BACKUP_DIR="$work/backups"
age-keygen -o "$work/key.txt" 2>/dev/null
BACKUP_AGE_RECIPIENT="$(age-keygen -y "$work/key.txt")"; export BACKUP_AGE_RECIPIENT
age-keygen -o "$work/other.txt" 2>/dev/null

# Known content, so a restore can be compared row by row instead of just "it ran".
psql -qAtc "CREATE TABLE IF NOT EXISTS alembic_version (version_num varchar(32) PRIMARY KEY);
            INSERT INTO alembic_version SELECT 'backup_test' WHERE NOT EXISTS (SELECT 1 FROM alembic_version);
            DROP TABLE IF EXISTS backup_probe;
            CREATE TABLE backup_probe (id int PRIMARY KEY, note text);
            INSERT INTO backup_probe SELECT i, 'row ' || i FROM generate_series(1, 500) i" >/dev/null
trap 'psql -qAtc "DROP TABLE IF EXISTS backup_probe" >/dev/null 2>&1; rm -rf "$work"' EXIT

passed=0; failed=0
check() { # description, command...
  local desc="$1"; shift
  if "$@" >"$work/out.txt" 2>&1; then passed=$((passed + 1)); echo "ok   $desc"
  else failed=$((failed + 1)); echo "FAIL $desc"; sed 's/^/     /' "$work/out.txt"; fi
}
refuses() { ! "$@"; }
last_run() { tail -n 1 "$BACKUP_DIR/runs.ndjson"; }
last_is() { last_run | jq -e "$1" >/dev/null; }

check "a backup is written, encrypted, with its checksum" bash -c '
  "$0/backup.sh" && f=$(ls "$BACKUP_DIR"/daily/*.dump.age) && test -s "$f" && test -s "$f.sha256" &&
  head -c 21 "$f" | grep -q "^age-encryption.org/v1" && ! grep -aq "PGDMP" "$f"' "$here"
check "the run is recorded with size and checksum" last_is '.kind=="backup" and .ok==true and .size_bytes>0 and (.sha256|length)==64'
check "verify accepts the intact backups" "$here/verify.sh"
check "the restore test proves the backup is usable" "$here/restore-test.sh" "$work/key.txt"
check "the restore test is recorded" last_is '.kind=="restore_test" and .ok==true'

file="$(find "$BACKUP_DIR/daily" -name '*.dump.age' | head -n 1)"
probe_digest() { psql -d "$1" -qAtc "SELECT md5(string_agg(id::text || note, ';' ORDER BY id)) FROM backup_probe"; }
restores_identically() {
  local db="vyrion_probe_$$" r=1
  if psql -d postgres -qAtc "CREATE DATABASE $db" >/dev/null &&
    "$here/restore.sh" "$file" "$work/key.txt" "$db" >/dev/null; then
    a="$(probe_digest "$PGDATABASE")"; b="$(probe_digest "$db")"
    [ -n "$a" ] && [ "$a" = "$b" ] && r=0
  fi
  psql -d postgres -qAtc "DROP DATABASE IF EXISTS $db" >/dev/null
  return "$r"
}
check "the restored data matches the original, row by row" restores_identically
check "a wrong key cannot restore" refuses "$here/restore.sh" "$file" "$work/other.txt" postgres
check "restore refuses a missing key file" refuses "$here/restore.sh" "$file" "$work/none.txt" postgres

cp "$file" "$work/saved.age"
printf 'x' >>"$file"
check "verify catches a modified backup" refuses "$here/verify.sh"
check "the failed verification is recorded" last_is '.kind=="verify" and .ok==false and (.error|test("damaged"))'
check "restore refuses a modified backup" refuses "$here/restore.sh" "$file" "$work/key.txt" postgres
cp "$work/saved.age" "$file"

before="$(find "$BACKUP_DIR/daily" -type f | wc -l)"
check "a failing pg_dump leaves no backup behind" refuses env PGDATABASE=does_not_exist "$here/backup.sh"
check "the failure is recorded" last_is '.kind=="backup" and .ok==false'
check "no partial file remains" test "$(find "$BACKUP_DIR/daily" -type f | wc -l)" = "$before"
check "a bad recipient is refused" refuses env BACKUP_AGE_RECIPIENT=nonsense "$here/backup.sh"

check "the second destination receives a verified copy" bash -c '
  BACKUP_COPY_DIR="$1/copy" "$0/backup.sh" && test "$(ls "$1"/copy/*.dump.age | wc -l)" = 1' "$here" "$work"

check "retention keeps only KEEP_DAILY backups" bash -c '
  for i in 1 2 3 4; do sleep 1.1; KEEP_DAILY=2 "$0/backup.sh" >/dev/null || exit 1; done
  test "$(ls "$BACKUP_DIR"/daily/*.dump.age | wc -l)" = 2 && test "$(ls "$BACKUP_DIR"/daily/*.sha256 | wc -l)" = 2' "$here"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
