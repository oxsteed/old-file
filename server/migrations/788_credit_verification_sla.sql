-- W17 P3-1017: give identity and sanctions reviews an explicit, monitorable SLA.
-- Existing rows remain valid; the monitor only acts on rows with a due time.
ALTER TABLE oxsteed_credit_identity_verifications
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;

ALTER TABLE oxsteed_credit_sanctions_screenings
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_credit_identity_verification_sla
  ON oxsteed_credit_identity_verifications (status, sla_due_at)
  WHERE status = 'pending' AND sla_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_sanctions_screening_sla
  ON oxsteed_credit_sanctions_screenings (result, sla_due_at)
  WHERE result = 'hit' AND cleared_at IS NULL AND sla_due_at IS NOT NULL;
