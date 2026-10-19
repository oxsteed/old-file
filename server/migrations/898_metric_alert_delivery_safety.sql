-- Analytics alert delivery safety.
-- Additive only. No financial ledger is changed.

-- 1. SMS claims gain a definitive 'failed' state (the provider rejected the
--    send, so nothing was delivered) alongside 'uncertain' (the process may
--    have contacted the provider). Uncertain claims are never resent.
ALTER TABLE metric_alert_sms_claims DROP CONSTRAINT IF EXISTS metric_alert_sms_claims_status_check;
ALTER TABLE metric_alert_sms_claims ADD CONSTRAINT metric_alert_sms_claims_status_check
  CHECK (status IN ('sending','sent','uncertain','failed'));
CREATE INDEX IF NOT EXISTS metric_alert_sms_claims_rule_status
  ON metric_alert_sms_claims(rule_id, status, created_at DESC);

-- 2. Durable fire claims. A fire is claimed (committed) before any channel is
--    contacted, so a crash between delivery and bookkeeping can never cause a
--    second delivery for the same crossing in a later cooldown bucket.
CREATE TABLE IF NOT EXISTS metric_alert_fires (
  id BIGSERIAL PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES metric_alert_rules(id) ON DELETE CASCADE,
  rule_updated_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value NUMERIC,
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed','delivered','not_delivered')),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS metric_alert_fires_rule_time
  ON metric_alert_fires(rule_id, claimed_at DESC);
