#!/usr/bin/env bash
# Shared helpers for the backup scripts. Sourced, never run.

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RUNS_LOG="${BACKUP_DIR}/runs.ndjson"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Appends one JSON line describing a run. Arguments: kind ok file size sha256 started error
record_run() {
  local kind="$1" ok="$2" file="$3" size="$4" sha="$5" started="$6" error="${7:-}"
  mkdir -p "$BACKUP_DIR"
  jq -cn \
    --arg kind "$kind" --argjson ok "$ok" --arg file "$file" \
    --argjson size "${size:-0}" --arg sha "$sha" \
    --arg started "$started" --arg finished "$(now)" --arg error "$error" \
    '{kind:$kind, ok:$ok, file:$file, size_bytes:$size, sha256:$sha,
      started_at:$started, finished_at:$finished, error:(if $error=="" then null else $error end)}' \
    >>"$RUNS_LOG"
}

file_size() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }

# The SHA-256 of a file, as plain hex.
digest() { sha256sum "$1" | cut -d' ' -f1; }

# True when the stored checksum still matches the file.
checksum_ok() {
  local file="$1" expected actual
  [ -f "$file.sha256" ] || return 1
  expected="$(cut -d' ' -f1 "$file.sha256")"
  actual="$(digest "$file")"
  [ "$expected" = "$actual" ]
}

# age files start with this line; anything else is not an encrypted backup.
looks_encrypted() { head -c 21 "$1" | grep -q '^age-encryption.org/v1'; }
