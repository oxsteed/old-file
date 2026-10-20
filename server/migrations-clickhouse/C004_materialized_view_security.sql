-- Materialized views read the inserted block under their migration owner's
-- rights, keeping the runtime writer restricted to INSERT on the raw table.
ALTER TABLE growth.activity_hourly_mv ON CLUSTER growth MODIFY SQL SECURITY DEFINER DEFINER = CURRENT_USER;
ALTER TABLE growth.subject_activity_daily_mv ON CLUSTER growth MODIFY SQL SECURITY DEFINER DEFINER = CURRENT_USER;
GRANT ON CLUSTER growth CLUSTER ON *.* TO growth_rights;
