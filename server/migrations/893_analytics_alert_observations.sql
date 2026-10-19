-- Durable evaluations and at-most-once SMS claims. All rows are synthetic
-- observations of metrics; this migration never changes financial ledgers.
CREATE TABLE IF NOT EXISTS metric_alert_observations (
  id BIGSERIAL PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES metric_alert_rules(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value NUMERIC,
  previous_value NUMERIC,
  compared_value NUMERIC,
  crossed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS metric_alert_observations_rule_time
  ON metric_alert_observations(rule_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS metric_alert_sms_claims (
  delivery_key TEXT PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES metric_alert_rules(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','uncertain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A process dying after its claim may already have contacted the provider.
-- Never automatically resend an uncertain SMS. Email keeps provider
-- idempotency; in-app keeps its existing unique notification delivery key.
