#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Exercise the host-side backup contract without Docker, Coolify, or the live
# backup directory. The fake Docker client still emits real gzip and tar
# artifacts so publication and checksum validation remain meaningful.

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPOSITORY_ROOT/scripts/backup-coolify-production.sh"
MONITOR="$REPOSITORY_ROOT/scripts/check-production-backup.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/oxsteed-backup-scheduler.XXXXXX")"
FAKE_BIN="$TEST_ROOT/bin"
BACKUP_ROOT="$TEST_ROOT/backups/production"
TOKEN_FILE="$TEST_ROOT/tunnel.token"
mkdir -p "$FAKE_BIN" "$BACKUP_ROOT"
chmod 700 "$TEST_ROOT" "$TEST_ROOT/backups" "$BACKUP_ROOT"
printf 'isolated-test-token\n' >"$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  echo "Local backup scheduler verification failed: $*" >&2
  exit 1
}

cat >"$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" == inspect ]]; then
  printf 'healthy\n'
  exit 0
fi

[[ "${1:-}" == exec ]] || exit 2
shift
if [[ "${1:-}" == -i ]]; then
  shift
fi
container="${1:-}"
shift
command="$*"

if [[ "${BACKUP_TEST_SLEEP:-}" =~ ^[0-9]+$ && "$BACKUP_TEST_SLEEP" -gt 0 ]]; then
  sleep "$BACKUP_TEST_SLEEP"
fi
if [[ "${BACKUP_TEST_FAIL_DUMP:-}" == 1 && "$command" == *'pg_dump -U'* ]]; then
  exit 42
fi
if [[ "$command" == *pg_restore* ]]; then
  exit 0
fi
if [[ "$command" == *pg_dumpall* ]]; then
  printf '%s\n' 'CREATE ROLE oxsteed;' 'CREATE DATABASE oxsteed_db;'
  exit 0
fi
if [[ "$command" == *'tar -czf -'* ]]; then
  fixture="${BACKUP_TEST_FIXTURE:?}"
  mkdir -p "$fixture/storage/app"
  printf '%s\n' 'APP_KEY=isolated-test' >"$fixture/.env"
  printf '%s\n' 'recovery fixture' >"$fixture/storage/app/readme.txt"
  tar -czf - -C "$fixture" .env storage/app
  exit 0
fi
printf '%s\n' "isolated PostgreSQL dump for $container"
EOF
chmod 700 "$FAKE_BIN/docker"

cat >"$FAKE_BIN/ditto" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cp -R "$1/." "$2/"
EOF
chmod 700 "$FAKE_BIN/ditto"

cat >"$FAKE_BIN/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cat >/dev/null
EOF
chmod 700 "$FAKE_BIN/pg_restore"

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' '{"status":"ready"}'
EOF
chmod 700 "$FAKE_BIN/curl"

export BACKUP_ROOT
export APP_DB_CONTAINER=isolated-postgres
export COOLIFY_DB_CONTAINER=isolated-coolify-db
export COOLIFY_CONTAINER=isolated-coolify
export CLOUDFLARE_TOKEN_FILE="$TOKEN_FILE"
export DOCKER_BIN="$FAKE_BIN/docker"
export DITTO_BIN="$FAKE_BIN/ditto"
export PG_RESTORE_BIN="$FAKE_BIN/pg_restore"
export CURL_BIN="$FAKE_BIN/curl"
export BACKUP_TEST_FIXTURE="$TEST_ROOT/coolify-fixture"
export MAX_AGE_HOURS=30
export MIN_FREE_GB=1
export RETENTION_DAYS=1

run_backup() {
  "$RUNNER"
}

run_monitor() {
  "$MONITOR"
}

assert_monitor_failure() {
  local expected="$1"
  set +e
  run_monitor >"$TEST_ROOT/monitor.out" 2>"$TEST_ROOT/monitor.err"
  local status=$?
  set -e
  (( status != 0 )) || fail "monitor unexpectedly passed: $expected"
  grep -F "$expected" "$TEST_ROOT/monitor.err" >/dev/null || {
    fail "monitor failure did not mention '$expected'"
  }
  grep -F 'state=FAILED' "$BACKUP_ROOT/backup-monitor.status" >/dev/null || {
    fail "monitor did not publish FAILED status: $expected"
  }
}

command -v plutil >/dev/null && {
  plutil -lint "$REPOSITORY_ROOT/scripts/com.oxsteed.production-backup.plist" >/dev/null
  plutil -lint "$REPOSITORY_ROOT/scripts/com.oxsteed.production-backup-monitor.plist" >/dev/null
}

run_backup >"$TEST_ROOT/backup.out"
snapshot_count_before="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l | tr -d ' ')"
(( snapshot_count_before == 1 )) || fail "expected one initial snapshot"
run_monitor >/dev/null
grep -F 'state=OK' "$BACKUP_ROOT/backup-monitor.status" >/dev/null || fail 'initial monitor did not pass'

# An orphaned manifest must not replace the published timestamped snapshot.
mkdir -p "$BACKUP_ROOT/.incomplete.orphan"
printf 'incomplete=true\n' >"$BACKUP_ROOT/.incomplete.orphan/MANIFEST"
run_monitor >/dev/null || fail 'monitor selected orphaned incomplete snapshot'

# The lock rejects an overlapping run, then safely replaces an ownerless lock.
BACKUP_TEST_SLEEP=2 run_backup >"$TEST_ROOT/overlap.out" 2>&1 & first_pid=$!
for _ in {1..20}; do
  [[ -f "$BACKUP_ROOT/.backup.lock/owner" ]] && break
  sleep 0.1
done
[[ -f "$BACKUP_ROOT/.backup.lock/owner" ]] || fail 'overlap backup never acquired lock'
set +e
run_backup >"$TEST_ROOT/overlap-rejected.out" 2>"$TEST_ROOT/overlap-rejected.err"
overlap_status=$?
set -e
wait "$first_pid"
(( overlap_status == 75 )) || fail "overlap lock returned $overlap_status instead of 75"
grep -F 'already running' "$TEST_ROOT/overlap-rejected.err" >/dev/null || fail 'overlap reason missing'

mkdir -p "$BACKUP_ROOT/.backup.lock"
printf '99999999\n' >"$BACKUP_ROOT/.backup.lock/owner"
sleep 1
run_backup >/dev/null

snapshot_count_before="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l | tr -d ' ')"
set +e
BACKUP_TEST_FAIL_DUMP=1 run_backup >"$TEST_ROOT/failed-dump.out" 2>"$TEST_ROOT/failed-dump.err"
failed_dump_status=$?
set -e
(( failed_dump_status != 0 )) || fail 'failed dump unexpectedly passed'
snapshot_count_after="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l | tr -d ' ')"
(( snapshot_count_after == snapshot_count_before )) || fail 'failed dump published a snapshot'

latest_dir="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | tail -1)"
printf 'corrupted\n' >>"$latest_dir/oxsteed-db.dump"
assert_monitor_failure 'checksum validation failed'
rm -rf -- "$latest_dir"
sleep 1
run_backup >/dev/null

old_dir="$BACKUP_ROOT/20000101T000000Z"
mkdir -p "$old_dir"
printf 'old\n' >"$old_dir/MANIFEST"
touch -t 200001010000 "$old_dir"
sleep 1
run_backup >/dev/null
[[ ! -e "$old_dir" ]] || fail 'retention did not remove old snapshot'

latest_dir="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | tail -1)"
while IFS= read -r candidate; do
  [[ "$candidate" == "$latest_dir" ]] || rm -rf -- "$candidate"
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort)
mv "$latest_dir" "$BACKUP_ROOT/20000101T000000Z"
assert_monitor_failure 'snapshot is'
rm -rf -- "$BACKUP_ROOT/20000101T000000Z"
sleep 1
run_backup >/dev/null

MIN_FREE_GB=99999999 assert_monitor_failure 'free disk space is below'

echo 'Local backup scheduler verification passed: success, lock, failure, incomplete, checksum, retention, stale, and disk-space checks'
