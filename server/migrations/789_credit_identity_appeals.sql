-- W17 P3-1019: rejected identity reviews can be appealed and re-queued.
ALTER TABLE oxsteed_credit_identity_verifications
  ADD COLUMN IF NOT EXISTS appeal_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS appeal_reason TEXT,
  ADD COLUMN IF NOT EXISTS appealed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appeal_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_review_reason TEXT;

UPDATE oxsteed_credit_identity_verifications
   SET appeal_status = NULL
 WHERE appeal_status IS NULL;

ALTER TABLE oxsteed_credit_identity_verifications
  DROP CONSTRAINT IF EXISTS credit_identity_appeal_status_check;
ALTER TABLE oxsteed_credit_identity_verifications
  ADD CONSTRAINT credit_identity_appeal_status_check
  CHECK (appeal_status IS NULL OR appeal_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_credit_identity_verification_appeals
  ON oxsteed_credit_identity_verifications (appeal_status, appealed_at)
  WHERE appeal_status = 'pending';
