#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# launchd does not inherit the interactive shell PATH. Keep Docker and
# Homebrew-backed utilities available when this runs unattended.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

BACKUP_ROOT="${BACKUP_ROOT:-/Users/oxsteed/server-backups/production}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-30}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"
BACKUP_MIRROR_ROOT="${BACKUP_MIRROR_ROOT:-}"
STATUS_FILE="$BACKUP_ROOT/backup-monitor.status"

export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima}"

write_status() {
  local state="$1" detail="$2" tmp_file
  tmp_file="$(mktemp "$BACKUP_ROOT/.monitor-status.XXXXXX")"
  printf 'checked_at_utc=%s\nstate=%s\ndetail=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$state" "$detail" >"$tmp_file"
  mv "$tmp_file" "$STATUS_FILE"
}

fail() {
  local detail="$1"
  write_status FAILED "$detail"
  echo "Production backup monitor failed: $detail" >&2
  exit 1
}

[[ -d "$BACKUP_ROOT" ]] || fail "backup directory is missing"
backup_parent="$(dirname "$BACKUP_ROOT")"
[[ -d "$backup_parent" ]] || fail "backup parent directory is missing"
[[ "$(stat -f '%Lp' "$backup_parent")" == "700" ]] || fail "backup parent directory permissions are not 700"
[[ "$(stat -f '%Lp' "$BACKUP_ROOT")" == "700" ]] || fail "backup directory permissions are not 700"

# Ignore disposable or interrupted dated directories. A published snapshot is
# identified by its manifest, which is moved into place only after validation.
latest_dir="$(find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -type f -name 'MANIFEST' -size +0c -exec dirname {} \; | sort | tail -1)"
[[ -n "$latest_dir" ]] || fail "no complete dated backup snapshot exists"

snapshot_name="$(basename "$latest_dir")"
snapshot_epoch="$(date -u -j -f '%Y%m%dT%H%M%SZ' "$snapshot_name" '+%s' 2>/dev/null || true)"
[[ -n "$snapshot_epoch" ]] || fail "latest snapshot name is invalid: $snapshot_name"
now_epoch="$(date -u '+%s')"
max_age_seconds=$((MAX_AGE_HOURS * 60 * 60))
age_seconds=$((now_epoch - snapshot_epoch))
(( age_seconds >= 0 && age_seconds <= max_age_seconds )) || fail "latest snapshot is ${age_seconds}s old"

for artifact in MANIFEST SHA256SUMS oxsteed-db.dump coolify-db.sql.gz coolify-config-and-storage.tgz cloudflared-tunnel.token; do
  [[ -s "$latest_dir/$artifact" ]] || fail "latest snapshot is missing $artifact"
done
(cd "$latest_dir" && shasum -a 256 -c SHA256SUMS >/dev/null) || fail "latest snapshot checksum validation failed"

if [[ -n "$BACKUP_MIRROR_ROOT" ]]; then
  [[ -d "$BACKUP_MIRROR_ROOT" ]] || fail "backup mirror is not mounted: $BACKUP_MIRROR_ROOT"
  mirror_dir="$BACKUP_MIRROR_ROOT/$snapshot_name"
  [[ -d "$mirror_dir" ]] || fail "backup mirror is missing snapshot: $snapshot_name"
  (cd "$mirror_dir" && shasum -a 256 -c SHA256SUMS >/dev/null) || fail "backup mirror checksum validation failed"
fi

free_kb="$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
required_kb=$((MIN_FREE_GB * 1024 * 1024))
[[ "$free_kb" =~ ^[0-9]+$ ]] || fail "could not read free disk space"
(( free_kb >= required_kb )) || fail "free disk space is below ${MIN_FREE_GB}GB"

for container in postgres-twsam5aiyvm0w1l2jqxx9ih3 coolify-db coolify; do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null)" == "healthy" ]] || fail "$container is not healthy"
done
curl -fsS --max-time 15 https://oxsteed.com/ready >/dev/null || fail "public readiness endpoint failed"

write_status OK "snapshot=$snapshot_name"
printf 'Production backup monitor passed: %s\n' "$snapshot_name"
