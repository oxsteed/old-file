BEGIN;

ALTER TABLE oxsteed_credit_cards ADD COLUMN IF NOT EXISTS freeze_origin TEXT
  CHECK (freeze_origin IN ('customer', 'admin', 'system'));
ALTER TABLE oxsteed_credit_cards ADD COLUMN IF NOT EXISTS found_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS oxsteed_credit_card_security_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  card_id UUID NOT NULL REFERENCES oxsteed_credit_cards(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('unfreeze', 'activate', 'pin_set')),
  binding_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_card_challenges_owner
  ON oxsteed_credit_card_security_challenges (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_card_challenges_expiry
  ON oxsteed_credit_card_security_challenges (expires_at);

CREATE TABLE IF NOT EXISTS oxsteed_credit_card_security_limits (
  customer_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oxsteed_credit_card_security_operations (
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key VARCHAR(160) NOT NULL,
  card_id UUID NOT NULL REFERENCES oxsteed_credit_cards(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, request_key)
);

CREATE TABLE IF NOT EXISTS oxsteed_credit_card_replacement_requests (
  retired_card_id UUID PRIMARY KEY REFERENCES oxsteed_credit_cards(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  replacement_card_id UUID UNIQUE REFERENCES oxsteed_credit_cards(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_card_replacement_due
  ON oxsteed_credit_card_replacement_requests (next_attempt_at)
  WHERE status = 'pending';

-- A retired credential cannot be silently restored through another code path.
CREATE OR REPLACE FUNCTION guard_credit_card_retirement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('lost', 'stolen', 'revoked', 'expired')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A retired card cannot change lifecycle state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS credit_card_retirement_guard ON oxsteed_credit_cards;
CREATE TRIGGER credit_card_retirement_guard BEFORE UPDATE OF status
  ON oxsteed_credit_cards FOR EACH ROW EXECUTE FUNCTION guard_credit_card_retirement();

-- Reuse the existing audited notification outbox; no second ledger or sender.
ALTER TABLE oxsteed_credit_notification_outbox ADD COLUMN IF NOT EXISTS card_audit_event_id
  BIGINT REFERENCES oxsteed_credit_audit_events(id) ON DELETE RESTRICT;
ALTER TABLE oxsteed_credit_notification_outbox DROP CONSTRAINT IF EXISTS oxsteed_credit_notification_outbox_source_check;
ALTER TABLE oxsteed_credit_notification_outbox ADD CONSTRAINT oxsteed_credit_notification_outbox_source_check
  CHECK (num_nonnulls(transaction_id, hold_id, card_audit_event_id) = 1);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_card_security_notification
  ON oxsteed_credit_notification_outbox (card_audit_event_id, user_id)
  WHERE card_audit_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_notification_outbox_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.card_audit_event_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM oxsteed_credit_audit_events a
      WHERE a.id = NEW.card_audit_event_id AND a.customer_id = NEW.user_id
        AND a.resource_type = 'credit_card') THEN
      RAISE EXCEPTION 'Card event recipient does not own the card event' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.hold_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM oxsteed_credit_holds h WHERE h.id = NEW.hold_id AND h.customer_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Credit hold notification recipient does not own the hold' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM oxsteed_credit_transactions t
    JOIN oxsteed_credit_accounts d ON d.id = t.debit_account_id
    JOIN oxsteed_credit_accounts c ON c.id = t.credit_account_id
    WHERE t.id = NEW.transaction_id AND (
      (d.account_type = 'customer_wallet' AND d.customer_id = NEW.user_id) OR
      (c.account_type = 'customer_wallet' AND c.customer_id = NEW.user_id))) THEN
    RAISE EXCEPTION 'Credit transaction notification recipient is not a wallet owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS oxsteed_credit_notification_outbox_source_guard ON oxsteed_credit_notification_outbox;
CREATE TRIGGER oxsteed_credit_notification_outbox_source_guard
  BEFORE INSERT OR UPDATE OF transaction_id, hold_id, card_audit_event_id, user_id
  ON oxsteed_credit_notification_outbox FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_notification_outbox_source();

CREATE OR REPLACE FUNCTION enqueue_credit_card_security_notification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resource_type = 'credit_card' AND NEW.customer_id IS NOT NULL THEN
    INSERT INTO oxsteed_credit_notification_outbox (card_audit_event_id, user_id, event_type, payload)
    VALUES (NEW.id, NEW.customer_id, 'card_security', jsonb_build_object(
      'eventType', 'card_security', 'action', NEW.action_type, 'cardId', NEW.resource_id,
      'auditEventId', NEW.id::text)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS credit_card_security_notification ON oxsteed_credit_audit_events;
CREATE TRIGGER credit_card_security_notification AFTER INSERT ON oxsteed_credit_audit_events
  FOR EACH ROW EXECUTE FUNCTION enqueue_credit_card_security_notification();

-- Carry the recipient into new account-propagated revocation events. Only
-- actually changed cards are audited, not previously revoked cards nearby
-- in time. Historical evidence remains untouched.
CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_account_status_to_cards()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status = 'active' THEN RETURN NEW; END IF;
  WITH changed AS (
    UPDATE oxsteed_credit_cards SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
    WHERE account_id = NEW.id AND status IN ('pending', 'active', 'frozen')
    RETURNING id, customer_id
  )
  INSERT INTO oxsteed_credit_audit_events
    (action_type, customer_id, resource_type, resource_id, reason, after_state, metadata)
  SELECT 'credit.card.account_status_propagated', customer_id, 'credit_card', id::text,
    'Card revoked because its OxSteed Credit account is no longer active',
    jsonb_build_object('status', 'revoked', 'accountStatus', NEW.status),
    jsonb_build_object('source', 'database_account_status_guard') FROM changed;
  RETURN NEW;
END;
$$;

COMMIT;
