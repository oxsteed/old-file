-- Preserve who created each settlement snapshot so approval and payment
-- review can reconstruct the full operator chain.
ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_settlements_created_by
  ON oxsteed_credit_settlements(created_by, created_at DESC);
