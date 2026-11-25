-- Group 13 Slice 4h (687, D-395): link agent credit adjustments to the
-- reconciliation exception they resolve, so the location surface can show
-- the adjustment -> exception match to the participant.
--
-- `credit_adjustments` is customer-scoped only: an agent adjustment had no
-- exception link anywhere, so a matched adjustment could not be attributed
-- to an exception without inventing one. This adds a nullable link, set at
-- propose time or once afterwards by the admin link endpoint, and never
-- edited after that. It is not a second adjustment ledger: the row, the
-- two-person rule, and the money path are unchanged. Additive only; safe to
-- run twice.
ALTER TABLE credit_adjustments
  ADD COLUMN IF NOT EXISTS reconciliation_exception_id UUID;

-- The FK constraint guard is scoped to this table (conrelid) as well as
-- the constraint name, so a same-named constraint elsewhere never skips it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'credit_adjustments'::regclass
      AND conname = 'credit_adjustments_recon_exception_fk'
  ) THEN
    ALTER TABLE credit_adjustments ADD CONSTRAINT credit_adjustments_recon_exception_fk
      FOREIGN KEY (reconciliation_exception_id) REFERENCES reconciliation_exceptions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_adjustments_recon_exception
  ON credit_adjustments (reconciliation_exception_id, created_at DESC);
