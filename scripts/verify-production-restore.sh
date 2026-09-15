#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/oxsteed-db.dump" >&2
  exit 1
fi

BACKUP_FILE="$1"
APP_DB_CONTAINER="${APP_DB_CONTAINER:-postgres-twsam5aiyvm0w1l2jqxx9ih3}"

[[ -s "$BACKUP_FILE" ]] || {
  echo "Backup dump is missing or empty: $BACKUP_FILE" >&2
  exit 1
}

export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima}"
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$APP_DB_CONTAINER" 2>/dev/null)" == "healthy" ]] || {
  echo "Database container is not healthy: $APP_DB_CONTAINER" >&2
  exit 1
}

DB_USER="$(docker exec "$APP_DB_CONTAINER" sh -lc 'printf "%s" "$POSTGRES_USER"')"
[[ -n "$DB_USER" ]] || {
  echo "Could not determine the database owner from $APP_DB_CONTAINER" >&2
  exit 1
}

STAMP="$(date -u +%Y%m%d%H%M%S)"
TEMP_DB="oxsteed_restore_verify_${STAMP}_${RANDOM}"

cleanup() {
  docker exec "$APP_DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$TEMP_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "$APP_DB_CONTAINER" createdb -U "$DB_USER" "$TEMP_DB"
docker exec -i "$APP_DB_CONTAINER" pg_restore \
  -U "$DB_USER" \
  --dbname="$TEMP_DB" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  < "$BACKUP_FILE"

migration_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  'SELECT count(*) FROM _migrations')"
[[ "$migration_count" =~ ^[0-9]+$ && "$migration_count" -gt 0 ]] || {
  echo "Restored database has no applied migrations" >&2
  exit 1
}

credit_table_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('oxsteed_credit_accounts', 'oxsteed_credit_transactions', 'oxsteed_credit_transaction_entries', 'oxsteed_credit_holds', 'oxsteed_credit_settlements', 'oxsteed_credit_settlement_reversals', 'oxsteed_credit_audit_events', 'oxsteed_credit_partner_ledgers', 'oxsteed_credit_partner_funding_records', 'oxsteed_credit_currency_quotes', 'oxsteed_credit_currency_conversions')")"
[[ "$credit_table_count" == "11" ]] || {
  echo "Restored database is missing required Credit tables (found $credit_table_count/11)" >&2
  exit 1
}

credit_integrity_trigger_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('oxsteed_credit_partner_ledger_guard', 'oxsteed_credit_partner_funding_guard', 'oxsteed_credit_currency_quote_immutable_guard', 'oxsteed_credit_currency_conversion_guard', 'oxsteed_credit_settlement_reversal_guard')")"
[[ "$credit_integrity_trigger_count" == "5" ]] || {
  echo "Restored database is missing required Credit integrity triggers (found $credit_integrity_trigger_count/5)" >&2
  exit 1
}

printf 'Production restore verification passed: migrations=%s credit_tables=%s credit_integrity_triggers=%s temporary_database=%s\n' \
  "$migration_count" "$credit_table_count" "$credit_integrity_trigger_count" "$TEMP_DB"
