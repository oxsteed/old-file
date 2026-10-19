-- Migration 903: record the access scope each alert observation was computed
-- under (decision 3). Regional admins' rules evaluate region-filtered rows.
ALTER TABLE metric_alert_observations
  ADD COLUMN IF NOT EXISTS scope_kind TEXT,
  ADD COLUMN IF NOT EXISTS region_ids INTEGER[];
