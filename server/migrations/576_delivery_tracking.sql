-- Full delivery tracking integration: additive tracking records.
-- The delivery state machine (localDeliveryState.js) remains authoritative;
-- tracking tables below provide evidence and suggestions only and never
-- mutate delivery_jobs status, pricing, or payments.

-- Registered driver devices (phones) and vehicle telematics trackers.
CREATE TABLE IF NOT EXISTS delivery_tracking_devices (
  id BIGSERIAL PRIMARY KEY,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('driver_phone', 'vehicle_tracker')),
  driver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id BIGINT REFERENCES delivery_vehicles(id) ON DELETE SET NULL,
  device_label VARCHAR(120),
  platform VARCHAR(60),
  app_version VARCHAR(40),
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'revoked')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_tracking_devices_owner_ck CHECK (
    (kind = 'driver_phone' AND driver_user_id IS NOT NULL)
    OR (kind = 'vehicle_tracker' AND vehicle_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tracking_devices_driver
  ON delivery_tracking_devices(driver_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tracking_devices_vehicle
  ON delivery_tracking_devices(vehicle_id) WHERE status = 'active';

-- A tracking session binding a device to one delivery (a delivery has at most
-- one active tracking assignment).
CREATE TABLE IF NOT EXISTS delivery_tracking_assignments (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL REFERENCES delivery_tracking_devices(id),
  driver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id BIGINT REFERENCES delivery_vehicles(id) ON DELETE SET NULL,
  source_policy VARCHAR(40) NOT NULL DEFAULT 'driver_gps'
    CHECK (source_policy IN ('driver_gps', 'telematics', 'telematics_with_gps_fallback')),
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'revoked')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  ended_reason VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_assignment_active
  ON delivery_tracking_assignments(delivery_job_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tracking_assignments_device
  ON delivery_tracking_assignments(device_id, status);

-- Raw location points. Retained 90 days; summaries live elsewhere.
CREATE TABLE IF NOT EXISTS delivery_location_points (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES delivery_tracking_assignments(id) ON DELETE CASCADE,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  source VARCHAR(40) NOT NULL
    CHECK (source IN ('driver_gps', 'geotab', 'samsara', 'motive', 'verizon_connect')),
  latitude NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters NUMERIC(10,2),
  speed_mps NUMERIC(10,2),
  heading_degrees NUMERIC(6,2),
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence BIGINT,
  validation_state VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (validation_state IN ('pending', 'valid', 'suspicious', 'rejected')),
  validation_notes TEXT,
  idempotency_key VARCHAR(160) UNIQUE,
  retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_location_points_assignment
  ON delivery_location_points(assignment_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_points_delivery
  ON delivery_location_points(delivery_job_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_points_retention
  ON delivery_location_points(retention_expires_at)
  WHERE validation_state <> 'rejected';

-- Normalized tracking events, including provider delivery receipts.
CREATE TABLE IF NOT EXISTS delivery_tracking_events (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  assignment_id BIGINT REFERENCES delivery_tracking_assignments(id) ON DELETE SET NULL,
  event_type VARCHAR(60) NOT NULL CHECK (event_type IN (
    'tracking_started', 'tracking_stopped', 'tracking_paused', 'tracking_resumed',
    'location_batch', 'geofence_arrival', 'geofence_departure',
    'scan_recorded', 'eta_updated', 'tracking_stale', 'tracking_reconnected',
    'tracking_exception', 'provider_receipt'
  )),
  event_version INTEGER NOT NULL DEFAULT 1,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(40),
  provider_event_id VARCHAR(160),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_events_provider
  ON delivery_tracking_events(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_events_delivery
  ON delivery_tracking_events(delivery_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_type
  ON delivery_tracking_events(event_type, created_at DESC);

-- Immutable QR/barcode scan events. Scans suggest milestones; they cannot
-- complete a delivery without the configured proof-of-delivery requirement.
CREATE TABLE IF NOT EXISTS delivery_scan_events (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  scan_type VARCHAR(24) NOT NULL
    CHECK (scan_type IN ('pickup', 'handoff', 'arrival', 'return', 'exception')),
  scanned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  code_value TEXT NOT NULL,
  code_format VARCHAR(40),
  idempotency_key VARCHAR(160) UNIQUE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_events_delivery
  ON delivery_scan_events(delivery_job_id, scanned_at DESC);

-- Geofence definitions (pickup + destination) created from delivery coordinates.
CREATE TABLE IF NOT EXISTS delivery_geofences (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('pickup', 'destination')),
  center_lat NUMERIC(9,6) NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng NUMERIC(9,6) NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (radius_meters > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_job_id, kind)
);

-- Arrival/departure observations. Suggestions only: never mark delivered and
-- never trigger financial actions.
CREATE TABLE IF NOT EXISTS delivery_geofence_observations (
  id BIGSERIAL PRIMARY KEY,
  geofence_id BIGINT NOT NULL REFERENCES delivery_geofences(id) ON DELETE CASCADE,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  observation VARCHAR(24) NOT NULL CHECK (observation IN ('arrival', 'departure')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofence_obs_delivery
  ON delivery_geofence_observations(delivery_job_id, observed_at DESC);

-- ETA snapshots with freshness metadata.
CREATE TABLE IF NOT EXISTS delivery_eta_snapshots (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  eta_at TIMESTAMPTZ,
  source VARCHAR(24) NOT NULL
    CHECK (source IN ('route_estimate', 'live_tracking', 'provider')),
  confidence VARCHAR(24) NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low', 'unavailable')),
  basis JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eta_snapshots_delivery
  ON delivery_eta_snapshots(delivery_job_id, created_at DESC);

-- Signed customer tracking links. Only the token hash is stored.
CREATE TABLE IF NOT EXISTS delivery_tracking_links (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  token_prefix VARCHAR(16) NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(120),
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_links_delivery
  ON delivery_tracking_links(delivery_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_links_expiry
  ON delivery_tracking_links(expires_at) WHERE revoked_at IS NULL;

-- Telematics provider connections: cursors, webhook subscriptions, sync errors.
-- Credentials and webhook secrets live in the secure configuration store;
-- only references are kept here.
CREATE TABLE IF NOT EXISTS delivery_telematics_connections (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL
    CHECK (provider IN ('geotab', 'samsara', 'motive', 'verizon_connect')),
  vehicle_id BIGINT REFERENCES delivery_vehicles(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'revoked', 'error')),
  cursor TEXT,
  webhook_subscription_id VARCHAR(160),
  webhook_secret_ref VARCHAR(160),
  credential_ref VARCHAR(160),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  sync_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telematics_conn_provider_vehicle
  ON delivery_telematics_connections(provider, vehicle_id)
  WHERE vehicle_id IS NOT NULL;

-- Tracking consent records. Consent is explicit, per delivery, revocable.
CREATE TABLE IF NOT EXISTS delivery_tracking_consent (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id BIGINT REFERENCES delivery_tracking_devices(id) ON DELETE SET NULL,
  consent_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoke_reason VARCHAR(120),
  retention_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_consent_active
  ON delivery_tracking_consent(delivery_job_id, driver_user_id)
  WHERE revoked_at IS NULL;
