-- Close the local delivery integrity gaps without changing the future
-- procurement/freight logistics model.

BEGIN;

ALTER TYPE local_delivery_status ADD VALUE IF NOT EXISTS 'returned';

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS quote_id BIGINT,
  ADD COLUMN IF NOT EXISTS quote_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quote_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quote_accepted_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS support_ticket_id BIGINT,
  ADD COLUMN IF NOT EXISTS proof_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proof_verified_by_user_id UUID REFERENCES users(id);

ALTER TABLE delivery_jobs
  DROP CONSTRAINT IF EXISTS delivery_jobs_dispatch_state_ck,
  ADD CONSTRAINT delivery_jobs_dispatch_state_ck CHECK (dispatch_state IN ('internal_review', 'internal_assignment_attempt', 'internal_assigned', 'marketplace_posted', 'assigned', 'exception', 'completed', 'returned'));

CREATE TABLE IF NOT EXISTS delivery_quotes (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES users(id),
  request_hash CHAR(64) NOT NULL,
  input_snapshot JSONB NOT NULL,
  price_snapshot JSONB NOT NULL,
  customer_total_cents INTEGER NOT NULL CHECK (customer_total_cents > 0),
  driver_payout_cents INTEGER NOT NULL CHECK (driver_payout_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  pricing_version VARCHAR(40) NOT NULL DEFAULT 'local-delivery-v1',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_quotes_job ON delivery_quotes(delivery_job_id)
  WHERE delivery_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_quotes_customer_hash ON delivery_quotes(customer_user_id, request_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_request_idempotency (
  customer_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key VARCHAR(160) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  delivery_job_id BIGINT REFERENCES delivery_jobs(id) ON DELETE SET NULL,
  response_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS delivery_action_idempotency (
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(48) NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (delivery_job_id, actor_user_id, action, idempotency_key)
);

ALTER TABLE delivery_proofs
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(24) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS object_key TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS pin_digest CHAR(64),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

ALTER TABLE delivery_proofs
  DROP CONSTRAINT IF EXISTS delivery_proofs_verification_status_ck,
  ADD CONSTRAINT delivery_proofs_verification_status_ck CHECK (verification_status IN ('pending', 'verified', 'rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_proofs_idempotency
  ON delivery_proofs(delivery_job_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE delivery_extras
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_intent_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS payment_idempotency_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS approved_amount_cents INTEGER;

ALTER TABLE delivery_extras
  DROP CONSTRAINT IF EXISTS delivery_extras_payment_status_ck,
  ADD CONSTRAINT delivery_extras_payment_status_ck CHECK (payment_status IN ('not_required', 'requires_action', 'authorized', 'captured', 'refunded', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_extras_idempotency
  ON delivery_extras(delivery_job_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_payments (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  delivery_extra_id BIGINT REFERENCES delivery_extras(id) ON DELETE SET NULL,
  customer_user_id UUID NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  provider VARCHAR(24) NOT NULL DEFAULT 'stripe',
  checkout_session_id VARCHAR(255) UNIQUE,
  payment_intent_id VARCHAR(255),
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  receipt_url TEXT,
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_payments_idempotency
  ON delivery_payments(customer_user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_delivery_payments_job ON delivery_payments(delivery_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_assignment_reservations (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_user_id UUID REFERENCES users(id),
  vehicle_id BIGINT REFERENCES delivery_vehicles(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_delivery_reservations_driver ON delivery_assignment_reservations(driver_user_id, starts_at, ends_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_delivery_reservations_vehicle ON delivery_assignment_reservations(vehicle_id, starts_at, ends_at)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_reservation_job_active
  ON delivery_assignment_reservations(delivery_job_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS delivery_reschedule_requests (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  pickup_window_start TIMESTAMPTZ,
  pickup_window_end TIMESTAMPTZ,
  delivery_window_start TIMESTAMPTZ,
  delivery_window_end TIMESTAMPTZ,
  reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_returns (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'in_transit', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_events (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  actor_user_id UUID REFERENCES users(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_job_id, event_type, event_version)
);

CREATE TABLE IF NOT EXISTS delivery_event_deliveries (
  event_id BIGINT NOT NULL REFERENCES delivery_events(id) ON DELETE CASCADE,
  consumer VARCHAR(80) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, consumer)
);

ALTER TABLE delivery_jobs
  DROP CONSTRAINT IF EXISTS delivery_jobs_quote_fk;
DO $$ BEGIN
  ALTER TABLE delivery_jobs ADD CONSTRAINT delivery_jobs_quote_fk FOREIGN KEY (quote_id) REFERENCES delivery_quotes(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_events_pending ON delivery_event_deliveries(status, updated_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_returned ON delivery_jobs(returned_at) WHERE returned_at IS NOT NULL;

COMMIT;
