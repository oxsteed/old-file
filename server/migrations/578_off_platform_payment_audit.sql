-- 578_off_platform_payment_audit.sql
-- Immutable audit event log for off-platform payment request records.
-- Every lifecycle transition on main_app_payment_requests is recorded here
-- so helpers, customers, and support can review the full history.

CREATE TABLE IF NOT EXISTS main_app_payment_request_events (
  id BIGSERIAL PRIMARY KEY,
  payment_request_id BIGINT NOT NULL REFERENCES main_app_payment_requests(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL
    CHECK (event_type IN ('created', 'proof_submitted', 'confirmed', 'cancelled', 'expired', 'note_added', 'viewed')),
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_request_events_request
  ON main_app_payment_request_events(payment_request_id, created_at DESC);

-- Prevent any UPDATE or DELETE on the event log — immutable audit trail
CREATE RULE payment_request_events_no_update AS ON UPDATE TO main_app_payment_request_events
  DO INSTEAD NOTHING;
CREATE RULE payment_request_events_no_delete AS ON DELETE TO main_app_payment_request_events
  DO INSTEAD NOTHING;
