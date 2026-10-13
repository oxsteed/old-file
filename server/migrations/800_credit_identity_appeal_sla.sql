-- Migration 800: SLA for credit identity appeal reviews (P3-10-F09).
--
-- The verification request and sanctions-hit review queues already carry
-- sla_due_at and are swept by checkVerificationSla. A rejected
-- verification's appeal (appeal_status = 'pending') is a third human
-- review queue, but it had no deadline: an appeal could sit undecided
-- forever. This adds appeal_sla_due_at, armed when the appeal is
-- submitted and cleared when it is decided, so the same sweep covers it.
--
-- Additive only; idempotent.

ALTER TABLE oxsteed_credit_identity_verifications
  ADD COLUMN IF NOT EXISTS appeal_sla_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_credit_identity_verification_appeal_sla
  ON oxsteed_credit_identity_verifications (appeal_status, appeal_sla_due_at)
  WHERE appeal_status = 'pending' AND appeal_sla_due_at IS NOT NULL;
