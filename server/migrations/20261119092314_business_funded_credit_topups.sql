-- PR804 Track C — G-22: business-funded Credit.
-- A business owner/manager can fund a named member's Credit. The top-up is
-- still credited to the member (customer_id); these columns record who paid
-- for it so funds never move silently. NULL for self-service top-ups.
ALTER TABLE oxsteed_credit_topups
  ADD COLUMN IF NOT EXISTS funded_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funded_by_business_id BIGINT NULL REFERENCES businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funding_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_topups_funded_by_business
  ON oxsteed_credit_topups (funded_by_business_id, created_at DESC)
  WHERE funded_by_business_id IS NOT NULL;
