#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/oxsteed-db.dump" >&2
  exit 1
fi

BACKUP_FILE="$1"
APP_DB_CONTAINER="${APP_DB_CONTAINER:-postgres-twsam5aiyvm0w1l2jqxx9ih3}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT_DIR/server/migrations}"

[[ -s "$BACKUP_FILE" ]] || {
  echo "Backup dump is missing or empty: $BACKUP_FILE" >&2
  exit 1
}

[[ -d "$MIGRATIONS_DIR" ]] || {
  echo "Migration source directory is missing: $MIGRATIONS_DIR" >&2
  exit 1
}

expected_migrations="$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort)"
expected_migration_count="$(printf '%s\n' "$expected_migrations" | awk 'NF { count += 1 } END { print count + 0 }')"

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

applied_migrations="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  'SELECT filename FROM _migrations ORDER BY filename')"
if [[ "$applied_migrations" != "$expected_migrations" ]]; then
  echo "Restored database migration set does not match the current source (found $migration_count, expected $expected_migration_count)." >&2
  diff -u <(printf '%s\n' "$expected_migrations") <(printf '%s\n' "$applied_migrations") >&2 || true
  exit 1
fi

credit_table_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('oxsteed_credit_accounts', 'oxsteed_credit_transactions', 'oxsteed_credit_transaction_entries', 'oxsteed_credit_holds', 'oxsteed_credit_settlements', 'oxsteed_credit_settlement_reversals', 'oxsteed_credit_audit_events', 'oxsteed_credit_partner_ledgers', 'oxsteed_credit_partner_funding_records', 'oxsteed_credit_currency_quotes', 'oxsteed_credit_currency_conversions', 'oxsteed_credit_cards')")"
[[ "$credit_table_count" == "12" ]] || {
  echo "Restored database is missing required Credit tables (found $credit_table_count/12)" >&2
  exit 1
}

direct_catalog_migration_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM _migrations WHERE filename IN ('523_direct_catalog_expansion.sql', '524_direct_catalog_tools.sql', '525_direct_catalog_1000_services.sql', '526_direct_catalog_tools_expansion.sql', '527_direct_catalog_tool_category_fk.sql', '528_direct_catalog_service_coverage.sql')")"
[[ "$direct_catalog_migration_count" == "6" ]] || {
  echo "Restored database is missing Direct catalog migrations (found $direct_catalog_migration_count/6)" >&2
  exit 1
}

quote_catalog_migration_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM _migrations WHERE filename = '529_quote_request_catalog_services.sql'")"
[[ "$quote_catalog_migration_count" == "1" ]] || {
  echo "Restored database is missing the relational quote catalog migration" >&2
  exit 1
}

quote_catalog_table_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quote_request_services'")"
[[ "$quote_catalog_table_count" == "1" ]] || {
  echo "Restored database is missing quote_request_services" >&2
  exit 1
}

tool_category_fk_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM pg_constraint WHERE conname = 'direct_catalog_tools_category_slug_fkey' AND conrelid = 'direct_catalog_tools'::regclass AND confrelid = 'direct_catalog_categories'::regclass")"
[[ "$tool_category_fk_count" == "1" ]] || {
  echo "Restored database is missing the Direct tool category foreign key" >&2
  exit 1
}

direct_service_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM direct_catalog_services WHERE slug LIKE 'direct-%'")"
[[ "$direct_service_count" == "1000" ]] || {
  echo "Restored database is missing the expanded Direct service inventory (found $direct_service_count/1000)" >&2
  exit 1
}

direct_service_quality="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) || '|' || count(DISTINCT category_id) || '|' || count(*) FILTER (WHERE name_i18n ? 'en' AND name_i18n ? 'es' AND name_i18n ? 'fr' AND name_i18n ? 'ht' AND name_i18n ? 'ar' AND description_i18n ? 'en' AND description_i18n ? 'es' AND description_i18n ? 'fr' AND description_i18n ? 'ht' AND description_i18n ? 'ar' AND price_cents IS NULL AND currency_code = 'USD' AND is_active AND is_published AND lifecycle_status = 'live' AND is_operationally_available AND NOT is_bookable AND NULLIF(BTRIM(service_area), '') IS NOT NULL) FROM direct_catalog_services WHERE slug LIKE 'direct-%'")"
[[ "$direct_service_quality" == "1000|5|1000" ]] || {
  echo "Restored Direct services failed inventory, category, localization, or safety checks: $direct_service_quality" >&2
  exit 1
}

direct_tool_quality="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) || '|' || count(DISTINCT category_slug) || '|' || count(*) FILTER (WHERE name_i18n ? 'en' AND name_i18n ? 'es' AND name_i18n ? 'fr' AND name_i18n ? 'ht' AND name_i18n ? 'ar' AND description_i18n ? 'en' AND description_i18n ? 'es' AND description_i18n ? 'fr' AND description_i18n ? 'ht' AND description_i18n ? 'ar' AND is_active AND is_published AND lifecycle_status = 'live' AND is_operationally_available AND NOT is_bookable AND NULLIF(BTRIM(service_area), '') IS NOT NULL) FROM direct_catalog_tools")"
[[ "$direct_tool_quality" == "40|5|40" ]] || {
  echo "Restored Direct tools failed inventory, category, localization, or safety checks: $direct_tool_quality" >&2
  exit 1
}

credit_integrity_trigger_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('oxsteed_credit_partner_ledger_guard', 'oxsteed_credit_partner_funding_guard', 'oxsteed_credit_currency_quote_immutable_guard', 'oxsteed_credit_currency_conversion_guard', 'oxsteed_credit_settlement_reversal_guard')")"
[[ "$credit_integrity_trigger_count" == "5" ]] || {
  echo "Restored database is missing required Credit integrity triggers (found $credit_integrity_trigger_count/5)" >&2
  exit 1
}

credit_disabled_trigger_count="$(docker exec "$APP_DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -Atqc \
  "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D' AND tgname IN ('oxsteed_credit_partner_ledger_guard', 'oxsteed_credit_partner_funding_guard', 'oxsteed_credit_currency_quote_immutable_guard', 'oxsteed_credit_currency_conversion_guard', 'oxsteed_credit_settlement_reversal_guard')")"
[[ "$credit_disabled_trigger_count" == "0" ]] || {
  echo "Restored database has disabled required Credit integrity triggers (found $credit_disabled_trigger_count)" >&2
  exit 1
}

# Prove that a restored trigger still rejects a mutation. The transaction is
# rolled back, so this probe cannot alter the restored database.
docker exec -i "$APP_DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$TEMP_DB" <<'SQL'
BEGIN;
DO $$
DECLARE
  quote_id BIGINT;
  mutation_rejected BOOLEAN := FALSE;
BEGIN
  INSERT INTO oxsteed_credit_currency_quotes (
    source_currency_code, target_currency_code, source_amount_minor_units,
    target_amount_minor_units, fee_amount_minor_units, rate_numerator,
    rate_denominator, provider, provider_quote_reference, expires_at,
    reason, idempotency_key
  ) VALUES (
    'USD', 'JPY', 100, 15000, 0, 150, 1, 'restore-verifier',
    'restore-check-' || gen_random_uuid()::text, NOW() + INTERVAL '1 hour',
    'rolled-back restore trigger probe', 'restore-check-' || gen_random_uuid()::text
  ) RETURNING id INTO quote_id;

  BEGIN
    UPDATE oxsteed_credit_currency_quotes
       SET reason = 'mutation must be rejected'
     WHERE id = quote_id;
  EXCEPTION WHEN check_violation THEN
    mutation_rejected := TRUE;
  END;

  IF NOT mutation_rejected THEN
    RAISE EXCEPTION 'Restored currency quote trigger did not reject an immutable-field mutation';
  END IF;
END;
$$;
ROLLBACK;
SQL

printf 'Production restore verification passed: migrations=%s direct_catalog_migrations=%s quote_catalog_migration=%s quote_catalog_table=%s direct_services=%s direct_tools=%s tool_category_fk=%s credit_tables=%s credit_integrity_triggers=%s temporary_database=%s\n' \
  "$migration_count" "$direct_catalog_migration_count" "$quote_catalog_migration_count" "$quote_catalog_table_count" "$direct_service_count" "${direct_tool_quality%%|*}" "$tool_category_fk_count" "$credit_table_count" "$credit_integrity_trigger_count" "$TEMP_DB"
