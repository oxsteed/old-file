-- Owner-approved 2026-10-25: per-subject activity summaries follow the same
-- 90-day activity retention as raw events and hourly sketches. This does not
-- change the separate account-summary or financial retention policies.
ALTER TABLE growth.subject_activity_daily ON CLUSTER growth
MODIFY TTL day + INTERVAL 90 DAY DELETE;
