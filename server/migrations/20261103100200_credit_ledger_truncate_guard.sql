-- Readiness review §1: row triggers make the Credit ledger and audit tables
-- append-only, but row triggers do not fire on TRUNCATE, so a role that can
-- truncate could erase history without any trigger noticing. Add a
-- statement-level BEFORE TRUNCATE guard to every append-only Credit ledger
-- and audit table, and revoke TRUNCATE from PUBLIC (same approach as
-- 624_ws5_audit_evidence_guards.sql). Detection of a superuser rewrite is
-- covered by the daily external audit-chain anchors
-- (20261103100100_credit_dormancy_audit_wind_down.sql).

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
    'oxsteed_credit_transactions',
    'oxsteed_credit_transaction_entries',
    'oxsteed_credit_accounts',
    'oxsteed_credit_audit_events',
    'oxsteed_credit_holds',
    'oxsteed_credit_settlements',
    'oxsteed_credit_settlement_reversals',
    'credit_audit_anchors',
    'admin_audit_log'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION oxsteed_credit_reject_truncate()',
        t || '_no_truncate', t);
      EXECUTE format('REVOKE TRUNCATE ON %I FROM PUBLIC', t);
    END IF;
  END LOOP;
END;
$$;
