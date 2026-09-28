-- Operational local delivery foundation. This remains separate from the
-- future procurement, warehouse, freight, and international logistics system.

BEGIN;

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS pieces INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS package_length_in NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS package_width_in NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS package_height_in NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS contents_category VARCHAR(80) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS declared_value_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fragile BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS perishable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hazmat_declared BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS origin_contact_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS origin_contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS origin_contact_company VARCHAR(160),
  ADD COLUMN IF NOT EXISTS origin_instructions TEXT,
  ADD COLUMN IF NOT EXISTS destination_contact_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS destination_contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS destination_contact_company VARCHAR(160),
  ADD COLUMN IF NOT EXISTS destination_instructions TEXT,
  ADD COLUMN IF NOT EXISTS pickup_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handling_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS proof_preference VARCHAR(32) NOT NULL DEFAULT 'recipient_confirmation',
  ADD COLUMN IF NOT EXISTS fulfillment_source VARCHAR(24) NOT NULL DEFAULT 'marketplace',
  ADD COLUMN IF NOT EXISTS dispatch_state VARCHAR(32) NOT NULL DEFAULT 'marketplace_posted',
  ADD COLUMN IF NOT EXISTS internal_driver_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS vehicle_id BIGINT,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS internal_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketplace_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketplace_release_reason TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_released_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(120);

ALTER TABLE delivery_jobs
  DROP CONSTRAINT IF EXISTS delivery_jobs_pieces_ck,
  ADD CONSTRAINT delivery_jobs_pieces_ck CHECK (pieces > 0 AND pieces <= 1000),
  DROP CONSTRAINT IF EXISTS delivery_jobs_dimensions_ck,
  ADD CONSTRAINT delivery_jobs_dimensions_ck CHECK (
    (package_length_in IS NULL OR package_length_in > 0)
    AND (package_width_in IS NULL OR package_width_in > 0)
    AND (package_height_in IS NULL OR package_height_in > 0)
  ),
  DROP CONSTRAINT IF EXISTS delivery_jobs_declared_value_ck,
  ADD CONSTRAINT delivery_jobs_declared_value_ck CHECK (declared_value_cents >= 0),
  DROP CONSTRAINT IF EXISTS delivery_jobs_hazmat_ck,
  ADD CONSTRAINT delivery_jobs_hazmat_ck CHECK (hazmat_declared = FALSE),
  DROP CONSTRAINT IF EXISTS delivery_jobs_proof_preference_ck,
  ADD CONSTRAINT delivery_jobs_proof_preference_ck CHECK (proof_preference IN ('pin', 'signature', 'photo', 'recipient_confirmation')),
  DROP CONSTRAINT IF EXISTS delivery_jobs_fulfillment_source_ck,
  ADD CONSTRAINT delivery_jobs_fulfillment_source_ck CHECK (fulfillment_source IN ('internal', 'marketplace')),
  DROP CONSTRAINT IF EXISTS delivery_jobs_dispatch_state_ck,
  ADD CONSTRAINT delivery_jobs_dispatch_state_ck CHECK (dispatch_state IN ('internal_review', 'internal_assigned', 'marketplace_posted', 'assigned', 'exception', 'completed'));

CREATE TABLE IF NOT EXISTS delivery_driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  vehicle_type VARCHAR(32),
  max_payload_lbs NUMERIC(10,2),
  cargo_length_in NUMERIC(10,2),
  cargo_width_in NUMERIC(10,2),
  cargo_height_in NUMERIC(10,2),
  equipment JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_area JSONB NOT NULL DEFAULT '{}'::jsonb,
  insurance_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_vehicles (
  id BIGSERIAL PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  vehicle_type VARCHAR(32) NOT NULL,
  max_payload_lbs NUMERIC(10,2) NOT NULL,
  cargo_length_in NUMERIC(10,2),
  cargo_width_in NUMERIC(10,2),
  cargo_height_in NUMERIC(10,2),
  equipment JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE delivery_jobs ADD CONSTRAINT delivery_jobs_vehicle_fk FOREIGN KEY (vehicle_id) REFERENCES delivery_vehicles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS delivery_dispatch_attempts (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  source VARCHAR(24) NOT NULL CHECK (source IN ('internal', 'marketplace')),
  driver_user_id UUID REFERENCES users(id),
  vehicle_id BIGINT REFERENCES delivery_vehicles(id),
  action VARCHAR(32) NOT NULL,
  reason TEXT,
  actor_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_activity (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  event_type VARCHAR(64) NOT NULL,
  customer_visible BOOLEAN NOT NULL DEFAULT TRUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  proof_type VARCHAR(32) NOT NULL CHECK (proof_type IN ('pin', 'signature', 'photo', 'recipient_confirmation')),
  proof_value TEXT,
  media_url TEXT,
  submitted_by_user_id UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_extras (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  category VARCHAR(48) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  notes TEXT NOT NULL,
  evidence_url TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'voided')),
  requested_by_user_id UUID REFERENCES users(id),
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_issues (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  evidence_url TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reported_by_user_id UUID REFERENCES users(id),
  resolution TEXT,
  resolved_by_user_id UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_jobs_dispatch ON delivery_jobs(dispatch_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_internal_driver ON delivery_jobs(internal_driver_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_jobs_client_request ON delivery_jobs(customer_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_activity_job ON delivery_activity(delivery_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_extras_job ON delivery_extras(delivery_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_issues_job ON delivery_issues(delivery_job_id, created_at DESC);

-- Existing MVP jobs were already available to marketplace helpers. Preserve
-- that behavior while all newly posted jobs begin in internal review.

COMMIT;
