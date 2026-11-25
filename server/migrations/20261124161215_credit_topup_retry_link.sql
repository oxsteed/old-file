-- Group 13 Slice 4f (680, D-376/D-378): link a retried top-up to the failed
-- top-up it retries, so the retry is a new attempt on the same terms — not
-- a mutation of the failed record and not a silent duplicate charge.
--
-- `retried_from_topup_id` is set at create time only, never edited
-- afterwards. The failed original stays exactly as it was (still `failed`,
-- still visible with its retry link); the retry is a fresh
-- `oxsteed_credit_topups` row created through the existing `createTopup`
-- path with the same amount/currency and a fresh idempotency key, so the
-- existing rail gates, compliance gate, step-up, and Stripe intent flow
-- all apply unchanged. A failed record gets at most one retry child (the
-- partial unique index): a repeat retry replays the existing child, and
-- a child that itself fails is retried from the child, forming a chain.
-- Additive only; safe to run twice.
ALTER TABLE oxsteed_credit_topups
  ADD COLUMN IF NOT EXISTS retried_from_topup_id UUID;

-- The FK constraint guard is scoped to this table (conrelid) as well as
-- the constraint name, so a same-named constraint elsewhere never skips it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'oxsteed_credit_topups'::regclass
      AND conname = 'oxsteed_credit_topups_retried_from_fk'
  ) THEN
    ALTER TABLE oxsteed_credit_topups ADD CONSTRAINT oxsteed_credit_topups_retried_from_fk
      FOREIGN KEY (retried_from_topup_id) REFERENCES oxsteed_credit_topups(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- At most one retry attempt per failed original. Partial: only rows that
-- are retries participate, so existing rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oxsteed_credit_topups_retried_from_unique
  ON oxsteed_credit_topups(retried_from_topup_id) WHERE retried_from_topup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_topups_retried_from
  ON oxsteed_credit_topups(retried_from_topup_id, created_at DESC);
