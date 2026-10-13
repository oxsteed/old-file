-- Review P1-159 / P1-164 / P1-160.
-- P1-164: completion now needs both parties; each side's confirmation is recorded.
ALTER TABLE work_agreements
  ADD COLUMN IF NOT EXISTS helper_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_completed_at TIMESTAMPTZ;

-- P1-159: dead enum values / dead column. `draft` and `closed` were never
-- written (create inserts pending_signatures; there is no close endpoint),
-- claim `under_review` was never set, and `disputed` was never read or
-- written (dispute state now comes from the job's disputes, P1-160).
UPDATE work_agreements SET status = 'pending_signatures' WHERE status = 'draft';
UPDATE work_agreements SET status = 'completed' WHERE status = 'closed';
ALTER TABLE work_agreements ALTER COLUMN status SET DEFAULT 'pending_signatures';
ALTER TABLE work_agreements DROP CONSTRAINT IF EXISTS work_agreements_status_check;
ALTER TABLE work_agreements ADD CONSTRAINT work_agreements_status_check
  CHECK (status IN ('pending_signatures', 'active', 'completed'));
ALTER TABLE work_agreements DROP COLUMN IF EXISTS disputed;

UPDATE work_agreement_warranty_claims SET status = 'filed' WHERE status = 'under_review';
ALTER TABLE work_agreement_warranty_claims DROP CONSTRAINT IF EXISTS work_agreement_warranty_claims_status_check;
ALTER TABLE work_agreement_warranty_claims ADD CONSTRAINT work_agreement_warranty_claims_status_check
  CHECK (status IN ('filed', 'resolved', 'denied'));
