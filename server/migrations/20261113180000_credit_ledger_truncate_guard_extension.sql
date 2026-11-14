-- Domain 8 #18: migration 20261103100200 installed BEFORE TRUNCATE guards
-- on 9 tables while claiming "every append-only Credit ledger and audit
-- table", but eight more tables carry no-update/no-delete rules (or a
-- raising immutability trigger) and no truncate guard:
-- oxsteed_credit_partner_funding_records, oxsteed_credit_currency_conversions,
-- food_customer_wallet_ledger, food_customer_wallet_operator_audit_events,
-- platform_ledger, main_app_payment_request_events,
-- helper_payment_policy_history, admin_user_action_log. Row triggers and
-- rules never fire on TRUNCATE, and REVOKE TRUNCATE FROM PUBLIC is a
-- no-op against the table owner, so the statement-level guard is the
-- only real protection on these tables. All eight tables were verified
-- present in the migrated schema before this migration was written.
-- A missing table fails the migration loudly instead of being skipped
-- silently. Does not touch 20261103100200.

CREATE OR REPLACE FUNCTION oxsteed_credit_reject_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; TRUNCATE is not permitted', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'oxsteed_credit_partner_funding_records',
    'oxsteed_credit_currency_conversions',
    'food_customer_wallet_ledger',
    'food_customer_wallet_operator_audit_events',
    'platform_ledger',
    'main_app_payment_request_events',
    'helper_payment_policy_history',
    'admin_user_action_log'
  ] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'truncate guard extension: table % does not exist', t;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION oxsteed_credit_reject_truncate()',
      t || '_no_truncate', t);
    EXECUTE format('REVOKE TRUNCATE ON %I FROM PUBLIC', t);
  END LOOP;
END;
$$;
