-- Group 13 Slice 4e (673, D-369/D-375): link agent credit adjustments to
-- the dispute they were proposed for, so the customer can see the pending
-- adjustment state on their own dispute.
--
-- `credit_adjustments` is customer-scoped only: an agent adjustment has no
-- dispute link anywhere, so a pending adjustment could not be attributed
-- to a dispute without inventing one. This adds a nullable link, set at
-- propose time only and never edited afterwards. It is not a second
-- adjustment ledger: the row, the two-person rule, and the money path are
-- unchanged. Additive only; safe to run twice.
ALTER TABLE credit_adjustments
  ADD COLUMN IF NOT EXISTS dispute_id UUID;

-- The FK constraint guard is scoped to this table (conrelid) as well as
-- the constraint name, so a same-named constraint elsewhere never skips it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'credit_adjustments'::regclass
      AND conname = 'credit_adjustments_dispute_fk'
  ) THEN
    ALTER TABLE credit_adjustments ADD CONSTRAINT credit_adjustments_dispute_fk
      FOREIGN KEY (dispute_id) REFERENCES oxsteed_credit_disputes(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_adjustments_dispute
  ON credit_adjustments (dispute_id, created_at DESC);
