-- Migration 218zz: Business workspace filename reconciliation
-- ----------------------------------------------------------------------
-- Context: migrations 181-193 had a number collision — two parallel
-- sets of files existed under the same prefix (the security/infra branch
-- and the business-workspace branch). On 2026-05-15 the business set
-- was renumbered to 219-231 to avoid confusion.
--
-- Effect on existing DBs: if a DB already ran the old filenames
-- (e.g., '181_business_messaging.sql'), the migration runner would now
-- see '219_business_messaging.sql' as "new" and try to re-apply it,
-- which would fail because CREATE INDEX statements are not idempotent.
--
-- This migration runs BEFORE the renamed files (sort order:
-- 218zz_... < 219_...) and inserts the NEW filenames into _migrations
-- for any OLD filename that was previously applied. The renamed files
-- are then correctly skipped on subsequent boots.
--
-- This file is safe to re-run; ON CONFLICT DO NOTHING is used.

INSERT INTO _migrations (filename)
SELECT new_name FROM (VALUES
  ('219_business_messaging.sql',                     '181_business_messaging.sql'),
  ('220_business_services.sql',                      '182_business_services.sql'),
  ('221_business_appointments.sql',                  '183_business_appointments.sql'),
  ('222_service_dynamic_pricing_base.sql',           '184_service_dynamic_pricing_base.sql'),
  ('223_service_pricing_audit.sql',                  '185_service_pricing_audit.sql'),
  ('224_customer_loyalty_segments.sql',              '186_customer_loyalty_segments.sql'),
  ('225_business_calendar_settings.sql',             '187_business_calendar_settings.sql'),
  ('226_appointment_notifications.sql',              '188_appointment_notifications.sql'),
  ('227_business_integrations.sql',                  '189_business_integrations.sql'),
  ('228_business_analytics.sql',                     '190_business_analytics.sql'),
  ('229_business_policies.sql',                      '191_business_policies.sql'),
  ('230_appointment_waitlist.sql',                   '192_appointment_waitlist.sql'),
  ('231_business_feature_settings.sql',              '193_business_feature_settings.sql')
) AS pairs(new_name, old_name)
WHERE EXISTS (
  SELECT 1 FROM _migrations m WHERE m.filename = pairs.old_name
)
ON CONFLICT (filename) DO NOTHING;
