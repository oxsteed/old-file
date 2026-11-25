-- Group 12 Slice 3b (606): operator territory acceptance (D-295/D-307).
-- Admin assignment is an offer, not an activation: the operator must
-- explicitly accept (or decline with a reason) before the operator surface
-- unlocks. The per-territory grant still mints at launch (unchanged).
-- Additive only; safe to run twice (IF NOT EXISTS throughout).

ALTER TABLE franchise_applications
  ADD COLUMN IF NOT EXISTS acceptance_status VARCHAR(20) NOT NULL DEFAULT 'not_offered'
    CHECK (acceptance_status IN ('not_offered', 'offered', 'accepted', 'declined'));

ALTER TABLE franchise_applications
  ADD COLUMN IF NOT EXISTS acceptance_reason TEXT;

ALTER TABLE franchise_applications
  ADD COLUMN IF NOT EXISTS acceptance_decided_at TIMESTAMPTZ;

ALTER TABLE franchise_applications
  ADD COLUMN IF NOT EXISTS acceptance_decided_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_franchise_applications_acceptance
  ON franchise_applications(acceptance_status);
