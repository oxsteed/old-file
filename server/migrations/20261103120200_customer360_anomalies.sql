-- Customer 360 upgrade 4: anomaly alerts (refund spikes, payout failures,
-- sign-in from a new country) with bundling and snooze, delivered through
-- the existing Customer 360 alert rules and worker.

CREATE TABLE IF NOT EXISTS customer_anomalies (
  id                 BIGSERIAL PRIMARY KEY,
  customer_id        UUID         NOT NULL REFERENCES users(id),
  kind               VARCHAR(40)  NOT NULL CHECK (kind IN ('refund_spike', 'payout_failures', 'new_country_login')),
  status             VARCHAR(20)  NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'snoozed', 'acknowledged', 'resolved')),
  occurrences        INTEGER      NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  first_detected_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_detected_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  evidence           JSONB        NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 4096),
  detection_keys     TEXT[]       NOT NULL DEFAULT '{}',
  snoozed_until      TIMESTAMPTZ,
  snoozed_by         UUID REFERENCES users(id),
  handled_by         UUID REFERENCES users(id),
  handled_at         TIMESTAMPTZ,
  revision           INTEGER      NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_anomalies_snooze_shape CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL)
);
-- Bundling: one live (open or snoozed) anomaly per customer and kind; new
-- detections increment it instead of creating more alerts.
CREATE UNIQUE INDEX IF NOT EXISTS customer_anomalies_live_bundle
  ON customer_anomalies (customer_id, kind) WHERE status IN ('open', 'snoozed');
CREATE INDEX IF NOT EXISTS customer_anomalies_queue_idx
  ON customer_anomalies (status, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS customer_anomalies_customer_idx
  ON customer_anomalies (customer_id, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS customer_anomalies_snooze_due_idx
  ON customer_anomalies (snoozed_until) WHERE status = 'snoozed';

-- Platform-wide anomaly watches reuse the alert rule table: customer_id is
-- NULL only for the two anomaly sources.
ALTER TABLE admin_customer_alert_rules ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE admin_customer_alert_rules DROP CONSTRAINT IF EXISTS admin_customer_alert_rules_global_scope;
ALTER TABLE admin_customer_alert_rules ADD CONSTRAINT admin_customer_alert_rules_global_scope
  CHECK (customer_id IS NOT NULL OR source IN ('anomaliesFinancial', 'anomaliesSecurity'));
CREATE UNIQUE INDEX IF NOT EXISTS admin_customer_alert_rules_global_unique
  ON admin_customer_alert_rules (admin_id, source) WHERE customer_id IS NULL;
-- Payout failure detection scans recent failures without a full table walk.
CREATE INDEX IF NOT EXISTS instant_payouts_failed_recent_idx
  ON instant_payouts (updated_at) WHERE status = 'failed';
