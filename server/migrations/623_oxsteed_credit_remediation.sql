-- Migration 623: OxSteed Credit audit remediation (Workstream 4).
--
-- H16: oxsteed_credit_customer_entitlements.customer_id was the only credit
-- foreign key using ON DELETE CASCADE; every other credit FK is
-- RESTRICT/SET NULL. A user delete would silently wipe their entitlements.
-- Switch the constraint to RESTRICT so the scheduled deletion job takes the
-- anonymize-and-retain path instead.
--
-- M27: currency quotes had no customer binding, so any customer could consume
-- another customer's open quote. Bind each quote to the customer it was
-- issued for and enforce the binding at consume time.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oxsteed_credit_customer_entitlements_customer_id_fkey'
  ) THEN
    ALTER TABLE oxsteed_credit_customer_entitlements
      DROP CONSTRAINT oxsteed_credit_customer_entitlements_customer_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oxsteed_credit_customer_entitlements_customer_id_restrict_fkey'
  ) THEN
    ALTER TABLE oxsteed_credit_customer_entitlements
      ADD CONSTRAINT oxsteed_credit_customer_entitlements_customer_id_restrict_fkey
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE oxsteed_credit_currency_quotes
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_currency_quotes_customer
  ON oxsteed_credit_currency_quotes(customer_id);
