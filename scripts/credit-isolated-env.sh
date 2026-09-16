#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.credit-test.yml"
SEED_FILE="$ROOT_DIR/scripts/credit-isolated-seed.sql"
STATE_DIR="${OXSTEED_CREDIT_TEST_STATE_DIR:-${TMPDIR:-/tmp}/oxsteed-credit-test}"
STATE_FILE="$STATE_DIR/environment.env"
ARTIFACT_DIR="$STATE_DIR/artifacts"

die() { printf 'credit-isolated-env: %s\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die 'Docker is required.'
  docker context show 2>/dev/null | grep -qx 'colima' || die "Docker context must be 'colima'; refusing to use another runtime."
  docker info >/dev/null 2>&1 || die 'Colima Docker runtime is not reachable. Start Colima and retry.'
  docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required.'
}

compose() {
  docker compose --env-file "$STATE_FILE" --project-name "$CREDIT_TEST_PROJECT" --file "$COMPOSE_FILE" "$@"
}

create_state() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  local suffix timestamp
  timestamp="$(date -u +%Y%m%dt%H%M%sz)"
  suffix="${timestamp}-$$"
  cat > "$STATE_FILE" <<EOF
CREDIT_TEST_PROJECT=oxsteed-credit-test-${suffix}
CREDIT_TEST_POSTGRES_VOLUME=oxsteed-credit-test-${suffix}-postgres
CREDIT_TEST_REDIS_VOLUME=oxsteed-credit-test-${suffix}-redis
CREDIT_TEST_DB_PASSWORD=$(openssl rand -hex 24)
CREDIT_TEST_JWT_SECRET=$(openssl rand -hex 32)
CREDIT_TEST_ENCRYPTION_KEY=$(openssl rand -hex 32)
CREDIT_TEST_LEDGER_SECRET=$(openssl rand -hex 32)
EOF
  chmod 600 "$STATE_FILE"
}

load_state() {
  if [ -f "$STATE_FILE" ] && ! grep -Eq '^CREDIT_TEST_PROJECT=[a-z0-9][a-z0-9_-]*$' "$STATE_FILE"; then
    mv "$STATE_FILE" "$STATE_FILE.invalid.$(date +%s)"
  fi
  [ -f "$STATE_FILE" ] || create_state
  # The generated state contains only shell-safe hex and identifiers.
  set -a
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  set +a
}

base_url() {
  local published=''
  local attempt
  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    published="$(compose port app 5000 2>/dev/null || true)"
    if [ -n "$published" ]; then
      printf 'http://%s\n' "$published"
      return 0
    fi
    sleep 1
  done
  die 'The isolated app port was not published within 60 seconds.'
}

save_failure_artifacts() {
  mkdir -p "$ARTIFACT_DIR"
  chmod 700 "$ARTIFACT_DIR"
  compose ps > "$ARTIFACT_DIR/compose-ps.txt" 2>&1 || true
  compose logs --no-color > "$ARTIFACT_DIR/compose.log" 2>&1 || true
  cp "$SEED_FILE" "$ARTIFACT_DIR/seed.sql"
  printf 'Failure artifacts saved under %s\n' "$ARTIFACT_DIR" >&2
}

wait_ready() {
  local url="$1"
  if ! node "$ROOT_DIR/server/scripts/credit-isolated-readiness.js" "$url" ready; then
    save_failure_artifacts
    die "Isolated API did not become ready at $url."
  fi
}

suspend_isolated_rail() {
  # Keep reusable fixtures fail-closed between checks; production is never targeted.
  compose exec -T app node -e "require('/app/server/services/oxsteedCreditService').setCreditRailStatus({ enabled: false, actorUserId: '22222222-2222-4222-8222-222222222222', reason: 'Isolated verification cleanup' }).catch((error) => { console.error(error.message); process.exitCode = 1; })" >/dev/null
}

start() {
  require_docker
  load_state
  compose up -d --build
  wait_ready "$(base_url)"
  printf 'Isolated environment: %s\n' "$CREDIT_TEST_PROJECT"
  printf 'Loopback API: %s\n' "$(base_url)"
}

seed() {
  require_docker
  load_state
  wait_ready "$(base_url)"
  compose exec -T -e "PGPASSWORD=$CREDIT_TEST_DB_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -U oxsteed -d oxsteed_db < "$SEED_FILE"
  # Keep the admin browser journey reproducible without weakening the MFA gate.
  # This synthetic 20-byte TOTP seed is encrypted with the disposable fixture key and
  # is never used outside the isolated test database.
  local admin_totp_secret
  admin_totp_secret="$(ENCRYPTION_KEY="$CREDIT_TEST_ENCRYPTION_KEY" node -e "process.stdout.write(require('$ROOT_DIR/server/utils/encryption').encrypt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'))")"
  [[ "$admin_totp_secret" =~ ^[a-f0-9:]+$ ]] || die 'Generated isolated admin MFA secret has an unexpected format.'
  compose exec -T -e "PGPASSWORD=$CREDIT_TEST_DB_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -U oxsteed -d oxsteed_db -c \
    "UPDATE users SET totp_secret = '$admin_totp_secret', totp_enabled = TRUE WHERE email IN ('credit-admin@example.test', 'credit-approver@example.test');" >/dev/null
  printf 'Synthetic fixture seeded in %s\n' "$CREDIT_TEST_PROJECT"
}

test_environment() {
  require_docker
  load_state
  suspend_isolated_rail
  wait_ready "$(base_url)"
  if ! compose exec -T app node /app/server/scripts/credit-isolated-smoke.js; then
    suspend_isolated_rail || true
    save_failure_artifacts
    return 1
  fi
  suspend_isolated_rail
}

accounting() {
  require_docker
  load_state
  suspend_isolated_rail
  wait_ready "$(base_url)"
  if ! compose exec -T app node /app/server/scripts/credit-isolated-accounting.js; then
    suspend_isolated_rail || true
    return 1
  fi
  suspend_isolated_rail
}

races() {
  require_docker
  load_state
  suspend_isolated_rail
  wait_ready "$(base_url)"
  if ! compose exec -T app node /app/server/scripts/credit-isolated-races.js; then
    suspend_isolated_rail || true
    save_failure_artifacts
    return 1
  fi
  suspend_isolated_rail
}

queue_recovery() {
  require_docker
  load_state
  wait_ready "$(base_url)"
  compose exec -T -e QUEUE_RECOVERY_TEST_MODE=true app node /app/server/scripts/verify-payment-queue-recovery.js
}

provider() {
  require_docker
  load_state
  wait_ready "$(base_url)"
  compose exec -T -e CREDIT_TEST_PROVIDER_MODE=true app node /app/server/scripts/verify-stripe-webhook-delivery.js
}

performance() {
  require_docker
  load_state
  suspend_isolated_rail
  wait_ready "$(base_url)"
  if ! compose exec -T \
    -e CREDIT_PERFORMANCE_TEST_MODE=true \
    -e CREDIT_TEST_PROJECT="$CREDIT_TEST_PROJECT" \
    -e CREDIT_PERFORMANCE_READ_SAMPLES="${CREDIT_PERFORMANCE_READ_SAMPLES:-10}" \
    -e CREDIT_PERFORMANCE_PURCHASES="${CREDIT_PERFORMANCE_PURCHASES:-8}" \
    -e CREDIT_PERFORMANCE_CONCURRENCY="${CREDIT_PERFORMANCE_CONCURRENCY:-10}" \
    -e CREDIT_PERFORMANCE_DURATION_MS="${CREDIT_PERFORMANCE_DURATION_MS:-0}" \
    -e CREDIT_PERFORMANCE_PARTNERS="${CREDIT_PERFORMANCE_PARTNERS:-1}" \
    app node /app/server/scripts/verify-credit-performance.js; then
    suspend_isolated_rail || true
    return 1
  fi
  suspend_isolated_rail
}

catalog_performance() {
  require_docker
  load_state
  suspend_isolated_rail
  wait_ready "$(base_url)"
  if ! compose exec -T \
    -e DIRECT_CATALOG_PUBLIC_API_URL=http://127.0.0.1:5000/api/direct/catalog \
    -e DIRECT_CATALOG_PERFORMANCE_TEST_MODE=true \
    -e DIRECT_CATALOG_PERFORMANCE_SAMPLES="${DIRECT_CATALOG_PERFORMANCE_SAMPLES:-20}" \
    -e DIRECT_CATALOG_PERFORMANCE_CONCURRENCY="${DIRECT_CATALOG_PERFORMANCE_CONCURRENCY:-4}" \
    app node /app/server/scripts/verify-direct-catalog-performance.js; then
    suspend_isolated_rail || true
    return 1
  fi
  suspend_isolated_rail
}

catalog() {
  require_docker
  load_state
  suspend_isolated_rail
  wait_ready "$(base_url)"
  if ! compose exec -T -e DIRECT_CATALOG_VERIFY_LIVE=true app node /app/server/scripts/verify-direct-catalog-expansion.js; then
    suspend_isolated_rail || true
    return 1
  fi
  suspend_isolated_rail
}

failures() {
  require_docker
  load_state
  suspend_isolated_rail
  local url
  url="$(base_url)"
  wait_ready "$url"

  run_dependency_failure() {
    local service="$1" dependency="$2"
    compose stop "$service" >/dev/null
    if ! node "$ROOT_DIR/server/scripts/credit-isolated-readiness.js" "$url" degraded "$dependency"; then
      compose start "$service" >/dev/null || true
      save_failure_artifacts
      return 1
    fi
    compose start "$service" >/dev/null
    if ! wait_ready "$url"; then
      save_failure_artifacts
      return 1
    fi
    printf 'Recovered isolated %s after %s outage.\n' "$dependency" "$service"
  }

  run_dependency_failure redis redis
  run_dependency_failure postgres database
  suspend_isolated_rail
  printf 'Isolated infrastructure recovery passed: Redis and PostgreSQL outages degraded readiness and recovered cleanly.\n'
}

down() {
  [ -f "$STATE_FILE" ] || { printf 'No isolated environment state found.\n'; return 0; }
  require_docker
  load_state
  compose down --volumes --remove-orphans
  rm -rf "$STATE_DIR"
  printf 'Removed only isolated environment %s and its volumes.\n' "$CREDIT_TEST_PROJECT"
}

reset() {
  if [ -f "$STATE_FILE" ]; then down; fi
  start
  seed
}

case "${1:-}" in
  start|up) start ;;
  seed) seed ;;
  test|smoke) test_environment ;;
  accounting) accounting ;;
  races) races ;;
  queue-recovery) queue_recovery ;;
  provider) provider ;;
  performance) performance ;;
  catalog) catalog ;;
  catalog-performance) catalog_performance ;;
  failures) failures ;;
  reset) reset ;;
  down|remove) down ;;
  *)
    printf 'Usage: %s {start|seed|test|accounting|races|queue-recovery|provider|performance|catalog|catalog-performance|failures|reset|down}\n' "${BASH_SOURCE[0]}"
    exit 2
    ;;
esac
