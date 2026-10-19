ALTER TABLE metric_alert_observations ADD COLUMN IF NOT EXISTS metric_name TEXT;
ALTER TABLE metric_alert_observations ADD COLUMN IF NOT EXISTS params JSONB;
ALTER TABLE metric_alert_observations ADD COLUMN IF NOT EXISTS rule_updated_at TIMESTAMPTZ;
-- Definition snapshots prevent a rule edit from relabeling past observations.
