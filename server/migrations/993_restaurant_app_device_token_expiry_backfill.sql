-- 993_restaurant_app_device_token_expiry_backfill.sql
-- Auth-audit item 17: legacy restaurant_app_devices rows (paired before
-- migration 786 added device_token_expires_at) carry a NULL expiry, and
-- requireDeviceCredential treats NULL as never-expiring, so any token
-- issued before 786 is immortal.
--
-- This migration (a) backfills a bounded 90-day expiry for every paired
-- device that holds a token but has no expiry recorded, and (b) installs a
-- column DEFAULT of NOW() + 90 days so future inserts can never create a
-- NULL-expiry row. Token issuance/rotation already assign
-- NOW() + INTERVAL '90 days' application-side (pairDevice,
-- rotateDeviceToken); the DEFAULT is the fail-closed backstop for any raw
-- insert path. Pre-existing data is untouched apart from the NULL backfill;
-- already-expiring rows keep their values.
UPDATE restaurant_app_devices
   SET device_token_expires_at = NOW() + INTERVAL '90 days'
 WHERE device_token_expires_at IS NULL
   AND status = 'paired'
   AND device_token_hash IS NOT NULL;

ALTER TABLE restaurant_app_devices
  ALTER COLUMN device_token_expires_at SET DEFAULT (NOW() + INTERVAL '90 days');
