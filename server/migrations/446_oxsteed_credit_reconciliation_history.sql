-- Preserve every reconciliation run so operators can compare repeated checks.
-- The original uniqueness rule caused a rerun of the same period to overwrite
-- the prior evidence instead of creating a new operational record.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname
    INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'oxsteed_credit_reconciliation_runs'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) LIKE 'UNIQUE (currency_code, period_start, period_end)%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE oxsteed_credit_reconciliation_runs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_reconciliation_history
  ON oxsteed_credit_reconciliation_runs(currency_code, started_at DESC, id DESC);
