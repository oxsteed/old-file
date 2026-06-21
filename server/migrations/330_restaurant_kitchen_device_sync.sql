-- Migration 330: Resumable Kitchen feed state and device sync health.

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS last_kitchen_event_id BIGINT NOT NULL DEFAULT 0
    CHECK (last_kitchen_event_id >= 0),
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(24) NOT NULL DEFAULT 'healthy'
    CHECK (sync_status IN ('healthy','degraded','error')),
  ADD COLUMN IF NOT EXISTS sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_restaurant_kitchen_devices_sync
  ON restaurant_app_devices (restaurant_id, sync_status, last_sync_at)
  WHERE app_key = 'kitchen' AND status = 'paired';
