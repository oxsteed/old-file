-- Auth-audit finding 34: device bearer tokens are not bound to any client
-- property. Record the observed network identity on every heartbeat so
-- token-usage anomalies (same token, new IP hash or new platform) are
-- logged for review. Detection only; no request is blocked on a change.
-- Nullable: rows created before this migration simply record on their
-- next heartbeat.

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS last_seen_ip_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS last_seen_platform VARCHAR(80);
