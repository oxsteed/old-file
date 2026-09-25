-- Migration 561: one-year Pro access for every newly created account
-- ================================================================
-- Trial columns were originally given a 90-day database default.  The
-- application has since standardized on a first-year Pro experience, but
-- older databases may still carry the original fee-config row/value. Keep
-- both sources of defaults aligned so every user-creation path gets the same
-- entitlement, including legacy and administrative inserts that omit the
-- trial columns.

ALTER TABLE users
  ALTER COLUMN trial_started_at SET DEFAULT NOW(),
  ALTER COLUMN trial_ends_at SET DEFAULT (NOW() + INTERVAL '365 days');

INSERT INTO fee_config
  (key, value, value_type, label, description, min_value, max_value)
VALUES
  ('trial_duration_days',
    365,
    'flat_dollars',
    'Trial Duration (Days)',
    'Number of days new users receive Pro access before reverting to the free tier.',
    365,
    730)
ON CONFLICT (key) DO UPDATE SET
  value = 365,
  min_value = 365,
  max_value = GREATEST(fee_config.max_value, 365),
  description = EXCLUDED.description;
