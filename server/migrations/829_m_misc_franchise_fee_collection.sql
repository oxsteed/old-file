BEGIN;

-- P2-9-F07: the franchise initial fee ($25,000) and marketing fee (2%) were
-- recorded on the agreement row but never collected; activateFranchiseStore
-- launched the store regardless. Track collection (or an explicit waiver)
-- so activation can fail closed until the fee is accounted for.
ALTER TABLE franchise_agreements
  ADD COLUMN IF NOT EXISTS initial_fee_collected_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_fee_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS initial_fee_collection_reference TEXT,
  ADD COLUMN IF NOT EXISTS initial_fee_waived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS initial_fee_waived_reason TEXT,
  ADD COLUMN IF NOT EXISTS initial_fee_waived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS initial_fee_waived_at TIMESTAMPTZ;

-- Marketing fees accrue against franchise revenue over time; record the
-- lifetime accrued total so the royalty service can reconcile.
ALTER TABLE franchise_agreements
  ADD COLUMN IF NOT EXISTS marketing_fee_accrued_cents INTEGER NOT NULL DEFAULT 0;

COMMIT;
