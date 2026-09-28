-- Additive safeguards for the delivery lifecycle. No historical links are inferred.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS proof_pin_digest TEXT,
  ADD COLUMN IF NOT EXISTS proof_pin_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proof_pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proof_pin_consumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS support_case_id UUID REFERENCES support_tickets(id),
  ADD COLUMN IF NOT EXISTS eta_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approaching_at TIMESTAMPTZ;
ALTER TABLE delivery_issues ADD COLUMN IF NOT EXISTS support_ticket_id UUID REFERENCES support_tickets(id);

ALTER TABLE delivery_jobs ADD CONSTRAINT delivery_single_owner_ck
  CHECK (helper_user_id IS NULL OR internal_driver_user_id IS NULL) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_jobs_one_quote ON delivery_jobs(quote_id) WHERE quote_id IS NOT NULL;

CREATE TABLE delivery_proof_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  object_key TEXT UNIQUE NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 CHAR(64) NOT NULL,
  scan_status TEXT NOT NULL CHECK (scan_status = 'clean'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE delivery_proofs ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES delivery_proof_uploads(id);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_proofs_upload_once ON delivery_proofs(upload_id) WHERE upload_id IS NOT NULL;

ALTER TABLE delivery_driver_profiles
  ADD COLUMN IF NOT EXISTS max_pieces INTEGER NOT NULL DEFAULT 1 CHECK (max_pieces > 0),
  ADD COLUMN IF NOT EXISTS fragile_supported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS perishable_supported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insurance_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ;
ALTER TABLE delivery_vehicles
  ADD COLUMN IF NOT EXISTS max_pieces INTEGER NOT NULL DEFAULT 1 CHECK (max_pieces > 0),
  ADD COLUMN IF NOT EXISTS fragile_supported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS perishable_supported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_area JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS insurance_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insurance_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ;

-- Constraints serialize even two assignments which initially find no reservation.
ALTER TABLE delivery_assignment_reservations ADD CONSTRAINT delivery_driver_no_overlap
  EXCLUDE USING gist (driver_user_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
  WHERE (status = 'active' AND driver_user_id IS NOT NULL);
ALTER TABLE delivery_assignment_reservations ADD CONSTRAINT delivery_vehicle_no_overlap
  EXCLUDE USING gist (vehicle_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
  WHERE (status = 'active' AND vehicle_id IS NOT NULL);

ALTER TABLE delivery_returns
  ADD COLUMN IF NOT EXISTS previous_status TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT TRUE;
-- Existing internal release events are never customer notifications.
UPDATE delivery_events SET customer_visible = FALSE WHERE event_type IN ('delivery_marketplace_released','delivery_assignment_failed');

CREATE FUNCTION delivery_quote_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.input_snapshot,NEW.price_snapshot,NEW.request_hash,NEW.customer_total_cents,NEW.driver_payout_cents,
      NEW.currency,NEW.pricing_version,NEW.expires_at,NEW.customer_user_id)
     IS DISTINCT FROM
     (OLD.input_snapshot,OLD.price_snapshot,OLD.request_hash,OLD.customer_total_cents,OLD.driver_payout_cents,
      OLD.currency,OLD.pricing_version,OLD.expires_at,OLD.customer_user_id)
     OR (OLD.accepted_at IS NOT NULL AND (NEW.accepted_at,NEW.delivery_job_id,NEW.accepted_by_user_id)
         IS DISTINCT FROM (OLD.accepted_at,OLD.delivery_job_id,OLD.accepted_by_user_id)) THEN
    RAISE EXCEPTION 'Accepted quote and pricing inputs are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_quote_immutable BEFORE UPDATE ON delivery_quotes
  FOR EACH ROW EXECUTE FUNCTION delivery_quote_immutable();

CREATE FUNCTION delivery_price_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.quote_id IS NOT NULL AND (NEW.quote_id,NEW.customer_total_cents,NEW.driver_payout_cents,NEW.price_snapshot)
    IS DISTINCT FROM (OLD.quote_id,OLD.customer_total_cents,OLD.driver_payout_cents,OLD.price_snapshot) THEN
    RAISE EXCEPTION 'Delivery accepted pricing is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_price_immutable BEFORE UPDATE ON delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION delivery_price_immutable();
COMMIT;
