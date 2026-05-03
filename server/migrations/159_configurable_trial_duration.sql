-- Migration 159: Configurable trial duration
-- ================================================================
-- Adds trial_duration_days to fee_config so super-admins can adjust
-- trial duration without code changes. Starts at 365 days.

INSERT INTO fee_config
  (key, value, value_type, label, description, min_value, max_value)
VALUES
  ('trial_duration_days',
    365,
    'flat_dollars',
    'Trial Duration (Days)',
    'Number of days new users get a trial before reverting to free tier. Super-admins can adjust this value.',
    1,
    730)
ON CONFLICT (key) DO NOTHING;
