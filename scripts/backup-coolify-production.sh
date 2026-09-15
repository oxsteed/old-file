#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Back up the live Coolify-managed data, not the retired SQLite backend.
# Publish a snapshot only after every artifact has passed its integrity check.

BACKUP_ROOT="${BACKUP_ROOT:-/Users/oxsteed/server-backups/production}"
APP_DB_CONTAINER="${APP_DB_CONTAINER:-postgres-twsam5aiyvm0w1l2jqxx9ih3}"
COOLIFY_DB_CONTAINER="${COOLIFY_DB_CONTAINER:-coolify-db}"
COOLIFY_CONTAINER="${COOLIFY_CONTAINER:-coolify}"
CLOUDFLARE_TOKEN_FILE="${CLOUDFLARE_TOKEN_FILE:-/Users/oxsteed/Library/Application Support/OxSteed/cloudflared/tunnel.token}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_MIRROR_ROOT="${BACKUP_MIRROR_ROOT:-}"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$(dirname "$BACKUP_ROOT")" "$BACKUP_ROOT"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL_DIR="$BACKUP_ROOT/$STAMP"
TMP_DIR="$(mktemp -d "$BACKUP_ROOT/.incomplete.XXXXXX")"

cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT

health() {
  local container="$1"
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null)" == "healthy" ]]
}

for container in "$APP_DB_CONTAINER" "$COOLIFY_DB_CONTAINER" "$COOLIFY_CONTAINER"; do
  health "$container" || {
    echo "Container is not healthy: $container" >&2
    exit 1
  }
done

[[ -s "$CLOUDFLARE_TOKEN_FILE" ]] || {
  echo "Cloudflare tunnel token is missing: $CLOUDFLARE_TOKEN_FILE" >&2
  exit 1
}

export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima}"

# Container environment supplies database names and users without exposing passwords.
docker exec "$APP_DB_CONTAINER" sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  >"$TMP_DIR/oxsteed-db.dump"
docker exec "$COOLIFY_DB_CONTAINER" sh -lc \
  'pg_dumpall -U "$POSTGRES_USER" --clean --if-exists --no-role-passwords' \
  | gzip -9 >"$TMP_DIR/coolify-db.sql.gz"
docker exec "$COOLIFY_CONTAINER" tar -czf - -C /var/www/html .env storage/app \
  >"$TMP_DIR/coolify-config-and-storage.tgz"
install -m 600 "$CLOUDFLARE_TOKEN_FILE" "$TMP_DIR/cloudflared-tunnel.token"

docker exec -i "$APP_DB_CONTAINER" pg_restore --list <"$TMP_DIR/oxsteed-db.dump" >/dev/null
gzip -t "$TMP_DIR/coolify-db.sql.gz"
tar -tzf "$TMP_DIR/coolify-config-and-storage.tgz" >/dev/null

printf 'created_at_utc=%s\n' "$STAMP" >"$TMP_DIR/MANIFEST"
printf 'app_db_container=%s\n' "$APP_DB_CONTAINER" >>"$TMP_DIR/MANIFEST"
printf 'coolify_db_container=%s\n' "$COOLIFY_DB_CONTAINER" >>"$TMP_DIR/MANIFEST"
printf 'coolify_container=%s\n' "$COOLIFY_CONTAINER" >>"$TMP_DIR/MANIFEST"
printf 'artifacts=oxsteed-db.dump,coolify-db.sql.gz,coolify-config-and-storage.tgz,cloudflared-tunnel.token\n' >>"$TMP_DIR/MANIFEST"
printf 'validation=pg_restore-list,gzip-test,tar-list\n' >>"$TMP_DIR/MANIFEST"

[[ ! -e "$FINAL_DIR" ]] || {
  echo "Backup destination already exists: $FINAL_DIR" >&2
  exit 1
}
mv "$TMP_DIR" "$FINAL_DIR"
chmod 700 "$FINAL_DIR"
chmod 600 "$FINAL_DIR"/*
(cd "$FINAL_DIR" && shasum -a 256 * >SHA256SUMS)
chmod 600 "$FINAL_DIR/SHA256SUMS"

# A mounted recovery volume is an optional second copy. It must not overlap
# the local root, and its checksum is verified before the run is successful.
if [[ -n "$BACKUP_MIRROR_ROOT" ]]; then
  [[ -d "$BACKUP_MIRROR_ROOT" ]] || {
    echo "Backup mirror is not mounted: $BACKUP_MIRROR_ROOT" >&2
    exit 1
  }
  [[ "$BACKUP_MIRROR_ROOT" != "$BACKUP_ROOT" && "$BACKUP_MIRROR_ROOT" != "$BACKUP_ROOT"/* ]] || {
    echo "Backup mirror must be separate from the local backup root" >&2
    exit 1
  }
  MIRROR_DIR="$BACKUP_MIRROR_ROOT/$STAMP"
  [[ ! -e "$MIRROR_DIR" ]] || {
    echo "Backup mirror destination already exists: $MIRROR_DIR" >&2
    exit 1
  }
  mkdir -p "$MIRROR_DIR"
  chmod 700 "$MIRROR_DIR"
  ditto "$FINAL_DIR/" "$MIRROR_DIR/"
  chmod 600 "$MIRROR_DIR"/*
  (cd "$MIRROR_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null)
  find "$BACKUP_MIRROR_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' \
    -mtime +"$RETENTION_DAYS" -prune -exec rm -rf -- {} +
  printf 'Backup mirror created and verified: %s\n' "$MIRROR_DIR"
fi

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' \
  -mtime +"$RETENTION_DAYS" -prune -exec rm -rf -- {} +
printf 'Backup created and verified: %s\n' "$FINAL_DIR"
