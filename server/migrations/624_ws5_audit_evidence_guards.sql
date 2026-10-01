-- Migration 624 (Workstream 5): audit-evidence guards.
--
-- 20-agent audit remediation (authorized 2026-09-30). Idempotent; safe to re-run.
--
--  C3  Drop the CHECK (revoked_at IS NULL OR last_used_at IS NULL) on
--      api_product_keys. The API-key validator stamps last_used_at on every
--      use, so revokeApiKey 500s for any key that was ever used and a
--      compromised connector key cannot be killed. Dropping the constraint
--      restores revocation; validator already 401s revoked keys.
--  H6  Audit tables must survive deletion of the record they describe.
--      business_audit_log.business_id, restaurant_inventory_audit_events
--      .restaurant_id and food_customer_wallet_operator_audit_events
--      .restaurant_id change from ON DELETE CASCADE to ON DELETE RESTRICT,
--      so the scheduled deletion job fails closed (rolls back, logs) instead
--      of wiping audit history. Follow-up: archive-then-delete flow in
--      scheduledDeletionJob for owners whose businesses carry audit rows.
--  M15 Legal holds / retention rows must not cascade-delete with the document
--      they protect: legal_compliance_holds.document_id and
--      legal_data_retention.document_id become ON DELETE RESTRICT.
--  M16 Drop the dead DO INSTEAD NOTHING rules on oxsteed_credit_audit_events
--      (migration 467 re-installed them AFTER the raising immutability
--      trigger, so the trigger never fired). With the rules gone, the
--      BEFORE UPDATE OR DELETE trigger actually raises on tamper.
--  L6  The 001/admin no-delete rules silently swallowed DELETEs. Replace with
--      raising triggers on admin_audit_log and admin_user_action_log, and
--      REVOKE TRUNCATE FROM PUBLIC on audit tables as defense-in-depth.
--      (Note: REVOKE is a no-op against the table owner; if the app connects
--      as owner, full TRUNCATE protection needs a non-owner app role.)
--  H7  Drop the dead compliance_audit_log table. It had zero writers, and
--      GET /api/monitoring/compliance-report derived SOC 2 / ISO 27001 status
--      from it (action = '*' matched nothing), i.e. perpetually COMPLIANT.
--      The endpoint is removed in code; the table goes here.
--  M19a Repair for 537_chat_booking_requests (multi-transaction,
--      non-idempotent: a mid-file process death left the ledger 'applying'
--      and retried ADD CONSTRAINTs crash-looped). Re-applies 537's end-state
--      idempotently and flips a 'failed' 537 ledger row to 'applied' only
--      when the full end-state is present. 537 itself is untouched.
--  M19c Rotate the 166 seed internal user's publicly-known bcrypt example
--      hash to an unusable random value (is_active=false already).

-- ══════════════════════════════════════════════════════════════════
-- C3: allow revoking keys that have been used
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE api_product_keys
  DROP CONSTRAINT IF EXISTS not_revoked_and_used;

-- ══════════════════════════════════════════════════════════════════
-- H6 + M15: CASCADE → RESTRICT on audit-evidence foreign keys
-- ══════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  -- business_audit_log.business_id → businesses(id)
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND t.relname = 'business_audit_log'
    AND a.attname = 'business_id' AND c.confdeltype = 'c';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE business_audit_log DROP CONSTRAINT %I', fk_name);
    ALTER TABLE business_audit_log
      ADD CONSTRAINT business_audit_log_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT;
  END IF;

  -- restaurant_inventory_audit_events.restaurant_id → food_restaurants(id)
  fk_name := NULL;
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND t.relname = 'restaurant_inventory_audit_events'
    AND a.attname = 'restaurant_id' AND c.confdeltype = 'c';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE restaurant_inventory_audit_events DROP CONSTRAINT %I', fk_name);
    ALTER TABLE restaurant_inventory_audit_events
      ADD CONSTRAINT restaurant_inventory_audit_events_restaurant_id_fkey
      FOREIGN KEY (restaurant_id) REFERENCES food_restaurants(id) ON DELETE RESTRICT;
  END IF;

  -- food_customer_wallet_operator_audit_events.restaurant_id → food_restaurants(id)
  fk_name := NULL;
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND t.relname = 'food_customer_wallet_operator_audit_events'
    AND a.attname = 'restaurant_id' AND c.confdeltype = 'c';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE food_customer_wallet_operator_audit_events DROP CONSTRAINT %I', fk_name);
    ALTER TABLE food_customer_wallet_operator_audit_events
      ADD CONSTRAINT food_customer_wallet_operator_audit_events_restaurant_id_fkey
      FOREIGN KEY (restaurant_id) REFERENCES food_restaurants(id) ON DELETE RESTRICT;
  END IF;

  -- M15: legal_compliance_holds.document_id → legal_documents(id)
  fk_name := NULL;
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND t.relname = 'legal_compliance_holds'
    AND a.attname = 'document_id' AND c.confdeltype = 'c';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE legal_compliance_holds DROP CONSTRAINT %I', fk_name);
    ALTER TABLE legal_compliance_holds
      ADD CONSTRAINT legal_compliance_holds_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE RESTRICT;
  END IF;

  -- M15: legal_data_retention.document_id → legal_documents(id)
  fk_name := NULL;
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND t.relname = 'legal_data_retention'
    AND a.attname = 'document_id' AND c.confdeltype = 'c';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE legal_data_retention DROP CONSTRAINT %I', fk_name);
    ALTER TABLE legal_data_retention
      ADD CONSTRAINT legal_data_retention_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- M16: drop the dead no-op rules so the raising trigger actually fires
-- ══════════════════════════════════════════════════════════════════
DROP RULE IF EXISTS oxsteed_credit_audit_no_update ON oxsteed_credit_audit_events;
DROP RULE IF EXISTS oxsteed_credit_audit_no_delete ON oxsteed_credit_audit_events;

-- ══════════════════════════════════════════════════════════════════
-- L6: swallow-nothing rules → raise loudly; harden TRUNCATE surface
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reject_audit_log_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit log table % is append-only; DELETE is not permitted', TG_TABLE_NAME
    USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

DROP RULE IF EXISTS audit_no_delete ON admin_audit_log;
DROP TRIGGER IF EXISTS admin_audit_log_no_delete ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_delete
  BEFORE DELETE ON admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_log_delete();

DROP RULE IF EXISTS user_action_log_no_delete ON admin_user_action_log;
DROP TRIGGER IF EXISTS admin_user_action_log_no_delete ON admin_user_action_log;
CREATE TRIGGER admin_user_action_log_no_delete
  BEFORE DELETE ON admin_user_action_log
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_log_delete();

-- Defense-in-depth: revoke TRUNCATE from non-owners on audit tables.
-- (No-op against the table owner; see header note.)
DO $$
DECLARE
  audit_tables TEXT[] := ARRAY[
    'admin_audit_log',
    'admin_user_action_log',
    'business_audit_log',
    'security_audit_log',
    'oxsteed_credit_audit_events',
    'legal_audit_log',
    'restaurant_inventory_audit_events',
    'food_customer_wallet_operator_audit_events',
    'legal_compliance_holds'
  ];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY audit_tables LOOP
    IF to_regclass(tbl) IS NOT NULL THEN
      EXECUTE format('REVOKE TRUNCATE ON %I FROM PUBLIC', tbl);
    END IF;
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- H7: drop the dead, writerless compliance table
-- ══════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS compliance_audit_log;

-- ══════════════════════════════════════════════════════════════════
-- M19a: idempotent repair of 537_chat_booking_requests end-state
-- ══════════════════════════════════════════════════════════════════
-- 537 used explicit BEGIN/COMMIT pairs inside the runner-managed session, so
-- a mid-file process death left the ledger 'applying' (boot abort) and a
-- retry of its bare ADD CONSTRAINTs crash-looped. 537 itself is untouched;
-- this block enforces its intended end-state idempotently.
DO $$
BEGIN
  -- Block 1: customer_id nullable
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_requests' AND column_name = 'customer_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE booking_requests ALTER COLUMN customer_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS conversation_id UUID,
  ADD COLUMN IF NOT EXISTS guest_session_id UUID,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
  ADD COLUMN IF NOT EXISTS quote_kind VARCHAR(16),
  ADD COLUMN IF NOT EXISTS quote_id TEXT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(64) DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS service_id TEXT,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(80);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_requester_check') THEN
    ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_requester_check;
    ALTER TABLE booking_requests
      ADD CONSTRAINT booking_requests_requester_check
      CHECK (customer_id IS NOT NULL OR guest_session_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_quote_kind_check') THEN
    ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_quote_kind_check;
    ALTER TABLE booking_requests
      ADD CONSTRAINT booking_requests_quote_kind_check
      CHECK (quote_kind IS NULL OR quote_kind IN ('helper', 'business'));
  END IF;

  -- Block 2: lifecycle status enum. Only recreate when the current
  -- definition does not cover 537's statuses, so later widenings are
  -- never narrowed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_status'
      AND pg_get_constraintdef(oid) LIKE '%counter_proposed%'
  ) THEN
    ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS valid_status;
    ALTER TABLE booking_requests
      ADD CONSTRAINT valid_status CHECK (
        status IN (
          'pending', 'accepted', 'declined', 'expired', 'cancelled',
          'accepted_cancelled', 'counter_proposed'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_booking_requests_conversation
  ON booking_requests(conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_requests_guest_session
  ON booking_requests(guest_session_id)
  WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_requests_appointment
  ON booking_requests(appointment_id)
  WHERE appointment_id IS NOT NULL;

-- If 537 is recorded as failed but the full end-state is present, the
-- ledger can safely advance; the stored checksum is the current file's.
DO $$
DECLARE
  end_state_ok BOOLEAN;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'conversation_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'guest_session_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'appointment_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'quote_kind')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'quote_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'source')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'service_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_requests' AND column_name = 'timezone')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_requester_check')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_quote_kind_check')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_status' AND pg_get_constraintdef(oid) LIKE '%counter_proposed%')
    INTO end_state_ok;

  IF end_state_ok THEN
    UPDATE _migrations
       SET status = 'applied', applied_at = NOW(), error = NULL
     WHERE filename = '537_chat_booking_requests.sql'
       AND status = 'failed';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- M19c: rotate the 166 seed hash to an unusable random value
-- ══════════════════════════════════════════════════════════════════
-- The internal AI-bookings placeholder user (is_active=false) shipped with a
-- publicly-known bcrypt example hash. Replace it with a random value that can
-- never verify (bcrypt hashes never start with '!'). The row is kept because
-- appointments reference it as customer_id.
UPDATE users
   SET password_hash = '!' || encode(gen_random_bytes(32), 'hex'),
       updated_at = NOW()
 WHERE id = '00000000-0000-4000-8000-000000000001'::uuid
   AND password_hash LIKE '$2a$%';
