-- Migration 467: make OxSteed Credit audit events tamper-evident.
--
-- The audit table is already append-only. This adds a chronological SHA-256
-- chain so operators can detect an altered, missing, or reordered event.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE oxsteed_credit_audit_events
  ADD COLUMN IF NOT EXISTS previous_event_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS event_hash VARCHAR(64);

-- Backfill safely despite the legacy no-op rules and immutability trigger.
-- The table lock prevents a new event from entering between the backfill and
-- the new insert trigger being installed.
LOCK TABLE oxsteed_credit_audit_events IN ACCESS EXCLUSIVE MODE;

DROP RULE IF EXISTS oxsteed_credit_audit_no_update ON oxsteed_credit_audit_events;
DROP RULE IF EXISTS oxsteed_credit_audit_no_delete ON oxsteed_credit_audit_events;
DROP TRIGGER IF EXISTS oxsteed_credit_audit_immutable_guard ON oxsteed_credit_audit_events;

CREATE OR REPLACE FUNCTION compute_oxsteed_credit_audit_event_hash(
  p_previous_event_hash TEXT,
  p_event oxsteed_credit_audit_events
)
RETURNS VARCHAR(64)
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      COALESCE($1, '') || ':' || $2.id::TEXT || ':' || EXTRACT(EPOCH FROM $2.created_at)::TEXT || ':' ||
      jsonb_build_object(
        'action_type', $2.action_type,
        'actor_user_id', $2.actor_user_id,
        'customer_id', $2.customer_id,
        'partner_id', $2.partner_id,
        'resource_type', $2.resource_type,
        'resource_id', $2.resource_id,
        'reason', $2.reason,
        'correlation_id', $2.correlation_id,
        'request_ip', $2.request_ip::TEXT,
        'before_state', $2.before_state,
        'after_state', $2.after_state,
        'metadata', COALESCE($2.metadata, '{}'::JSONB)
      )::TEXT,
      'sha256'
    ),
    'hex'
  );
$$;

DO $$
DECLARE
  audit_row RECORD;
  prior_hash VARCHAR(64);
  current_hash VARCHAR(64);
BEGIN
  FOR audit_row IN
    SELECT *
      FROM oxsteed_credit_audit_events
     ORDER BY created_at ASC, id ASC
  LOOP
    current_hash := compute_oxsteed_credit_audit_event_hash(prior_hash, audit_row);

    UPDATE oxsteed_credit_audit_events
       SET previous_event_hash = prior_hash,
           event_hash = current_hash
     WHERE id = audit_row.id;

    prior_hash := current_hash;
  END LOOP;
END;
$$;

ALTER TABLE oxsteed_credit_audit_events
  ALTER COLUMN event_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_audit_event_hash
  ON oxsteed_credit_audit_events(event_hash);

CREATE OR REPLACE FUNCTION set_oxsteed_credit_audit_event_hash()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prior_hash VARCHAR(64);
  prior_created_at TIMESTAMPTZ;
BEGIN
  -- Serialize the chain head lookup across app instances and workers.
  PERFORM pg_advisory_xact_lock(467, 1);

  SELECT event_hash, created_at
    INTO prior_hash, prior_created_at
    FROM oxsteed_credit_audit_events
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  -- Do not allow a caller to insert a backdated event that reorders the chain.
  NEW.created_at := GREATEST(CURRENT_TIMESTAMP, COALESCE(prior_created_at, CURRENT_TIMESTAMP));
  NEW.previous_event_hash := prior_hash;
  NEW.event_hash := compute_oxsteed_credit_audit_event_hash(prior_hash, NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_audit_hash_chain_guard ON oxsteed_credit_audit_events;

CREATE TRIGGER oxsteed_credit_audit_hash_chain_guard
  BEFORE INSERT ON oxsteed_credit_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION set_oxsteed_credit_audit_event_hash();

CREATE OR REPLACE FUNCTION reject_oxsteed_credit_audit_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION 'OxSteed Credit audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_audit_immutable_guard ON oxsteed_credit_audit_events;

CREATE TRIGGER oxsteed_credit_audit_immutable_guard
  BEFORE UPDATE OR DELETE ON oxsteed_credit_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_oxsteed_credit_audit_mutation();

CREATE OR REPLACE RULE oxsteed_credit_audit_no_update AS
  ON UPDATE TO oxsteed_credit_audit_events DO INSTEAD NOTHING;
CREATE OR REPLACE RULE oxsteed_credit_audit_no_delete AS
  ON DELETE TO oxsteed_credit_audit_events DO INSTEAD NOTHING;
