-- Persist the reason for an admin business review flag so the action is
-- actionable after the request that created it has completed.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS admin_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_businesses_admin_reviewed_at
  ON businesses (admin_reviewed_at DESC)
  WHERE admin_reviewed_at IS NOT NULL;
