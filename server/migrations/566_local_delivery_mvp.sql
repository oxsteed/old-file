-- Simple point-to-point delivery MVP. This is intentionally separate from
-- procurement, warehouse, and international logistics records.

DO $$ BEGIN
  CREATE TYPE local_delivery_status AS ENUM (
    'posted', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id                       BIGSERIAL PRIMARY KEY,
  reference                VARCHAR(40) UNIQUE NOT NULL,
  customer_user_id         UUID NOT NULL REFERENCES users(id),
  helper_user_id           UUID REFERENCES users(id),
  status                   local_delivery_status NOT NULL DEFAULT 'posted',
  origin_address           TEXT NOT NULL,
  origin_city              VARCHAR(120),
  origin_state             VARCHAR(120),
  origin_country           VARCHAR(3),
  origin_lat               NUMERIC(9,6) NOT NULL,
  origin_lng               NUMERIC(9,6) NOT NULL,
  destination_address      TEXT NOT NULL,
  destination_city         VARCHAR(120),
  destination_state        VARCHAR(120),
  destination_country      VARCHAR(3),
  destination_lat          NUMERIC(9,6) NOT NULL,
  destination_lng          NUMERIC(9,6) NOT NULL,
  distance_miles           NUMERIC(10,2) NOT NULL,
  duration_minutes         INTEGER,
  package_type             VARCHAR(20) NOT NULL,
  weight_lbs               NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_level            VARCHAR(20) NOT NULL DEFAULT 'standard',
  notes                    TEXT,
  price_snapshot           JSONB NOT NULL,
  customer_total_cents     INTEGER NOT NULL,
  driver_payout_cents      INTEGER NOT NULL,
  quote_expires_at         TIMESTAMPTZ,
  assigned_at              TIMESTAMPTZ,
  picked_up_at             TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_jobs_package_type_ck CHECK (package_type IN ('small','medium','large','oversized')),
  CONSTRAINT delivery_jobs_service_level_ck CHECK (service_level IN ('standard','same_day','rush')),
  CONSTRAINT delivery_jobs_positive_amounts_ck CHECK (customer_total_cents > 0 AND driver_payout_cents > 0),
  CONSTRAINT delivery_jobs_coordinates_ck CHECK (
    origin_lat BETWEEN -90 AND 90 AND origin_lng BETWEEN -180 AND 180
    AND destination_lat BETWEEN -90 AND 90 AND destination_lng BETWEEN -180 AND 180
  )
);

CREATE INDEX IF NOT EXISTS idx_delivery_jobs_customer ON delivery_jobs(customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_helper ON delivery_jobs(helper_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_open ON delivery_jobs(status, created_at DESC) WHERE status = 'posted';

