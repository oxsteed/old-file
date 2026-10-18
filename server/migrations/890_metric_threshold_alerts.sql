-- 890: Metric threshold alert rules (analytics platform, Phase 2, Item 9).
-- Per-admin rules over the governed metrics registry
-- (server/analytics/metricsRegistry.js). metric_name is validated against
-- the registry's alertable metrics in code at insert time (not a DB CHECK),
-- so new registry metrics become alertable without a schema change.
-- Also wires the dead admin_notification_prefs toggles: adds the master
-- notify_metric_alerts switch (existing columns untouched).
CREATE TABLE IF NOT EXISTS metric_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN ('>', '<', '==')),
  threshold NUMERIC NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::JSONB,
  cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 5 AND 43200),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  channel_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  channel_email BOOLEAN NOT NULL DEFAULT TRUE,
  channel_sms BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluated_at TIMESTAMPTZ,
  last_fired_at TIMESTAMPTZ,
  last_value NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_admin ON metric_alert_rules(admin_id);
CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_due ON metric_alert_rules(last_evaluated_at) WHERE is_active;

-- Wire the dead toggle (migration 706): master switch for metric
-- threshold alerts. Opt-out semantics like the other toggles (default
-- TRUE = alerts flow; admins who never opened My Settings are unaffected).
ALTER TABLE admin_notification_prefs
  ADD COLUMN IF NOT EXISTS notify_metric_alerts BOOLEAN NOT NULL DEFAULT TRUE;
