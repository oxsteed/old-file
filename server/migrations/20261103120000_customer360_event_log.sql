-- Customer 360 upgrade 1: unified, append-only customer event log.
--
-- customer_events is the single "who changed what, when" timeline for a
-- customer. Rows are written only through customer_event_append(), which
-- serialises per customer with an advisory lock and links each row to the
-- previous one with a SHA-256 hash, so the per-customer chain is
-- tamper-evident and replayable. UPDATE, DELETE and TRUNCATE are rejected.
--
-- Writers:
--   * AFTER triggers on admin_audit_log (target_type = 'user'),
--     user_login_history, payments (status), support_tickets (status) and
--     food_orders (status / payment_status) put a small row in
--     customer_event_inbox inside the writer's own transaction (an outbox),
--     so every code path is captured and the hot path never waits on the
--     chain lock. jobs/customer360Events.js drains the inbox in batches.
--   * Customer 360 itself (anomalies, merge reviews, inbox sends,
--     playbooks) appends directly through services/customer360Events.js.
--   * A one-time backfill walks each source by primary key with a cursor
--     (customer_event_ingest_cursors) and records each row's CURRENT state;
--     history that was never recorded is not invented.
--
-- Payloads are safe projections: statuses, ids, action names and
-- changed-field names. Admin-audit diffs pass through
-- customer_event_redact_diff(), which keeps scalar from/to values only for
-- non-personal fields and marks everything else {changed, redacted}.

CREATE TABLE IF NOT EXISTS customer_events (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   UUID        NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        VARCHAR(40) NOT NULL,
  event_type    VARCHAR(120) NOT NULL,
  actor_type    VARCHAR(20) NOT NULL CHECK (actor_type IN ('admin', 'customer', 'system', 'business')),
  actor_id      UUID,
  entity_type   VARCHAR(60),
  entity_id     VARCHAR(160),
  changes       JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object' AND pg_column_size(changes) <= 16384),
  dedupe_key    VARCHAR(255) NOT NULL UNIQUE,
  previous_hash CHAR(64),
  event_hash    CHAR(64)    NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_events_customer_idx ON customer_events (customer_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_events_chain_idx ON customer_events (customer_id, id DESC);
CREATE INDEX IF NOT EXISTS customer_events_entity_idx ON customer_events (customer_id, entity_type, entity_id, occurred_at, id);

CREATE OR REPLACE FUNCTION customer_events_reject_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer_events is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS customer_events_no_update ON customer_events;
CREATE TRIGGER customer_events_no_update BEFORE UPDATE OR DELETE ON customer_events
  FOR EACH ROW EXECUTE FUNCTION customer_events_reject_change();
DROP TRIGGER IF EXISTS customer_events_no_truncate ON customer_events;
CREATE TRIGGER customer_events_no_truncate BEFORE TRUNCATE ON customer_events
  FOR EACH STATEMENT EXECUTE FUNCTION customer_events_reject_change();
REVOKE TRUNCATE ON customer_events FROM PUBLIC;

-- Outbox filled by source triggers; drained into customer_events.
CREATE TABLE IF NOT EXISTS customer_event_inbox (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  UUID        NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL,
  source       VARCHAR(40) NOT NULL,
  event_type   VARCHAR(120) NOT NULL,
  actor_type   VARCHAR(20) NOT NULL,
  actor_id     UUID,
  entity_type  VARCHAR(60),
  entity_id    VARCHAR(160),
  changes      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key   VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_event_inbox_order_idx ON customer_event_inbox (id);

CREATE TABLE IF NOT EXISTS customer_event_ingest_cursors (
  source       VARCHAR(40) PRIMARY KEY,
  last_key     TEXT,
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append one event to the customer's chain. Idempotent on dedupe_key.
CREATE OR REPLACE FUNCTION customer_event_append(
  p_customer UUID, p_occurred TIMESTAMPTZ, p_source TEXT, p_type TEXT,
  p_actor_type TEXT, p_actor UUID, p_entity_type TEXT, p_entity_id TEXT,
  p_changes JSONB, p_dedupe TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_prev CHAR(64);
  v_hash CHAR(64);
  v_id   BIGINT;
  v_changes JSONB := COALESCE(p_changes, '{}'::jsonb);
BEGIN
  SELECT id INTO v_id FROM customer_events WHERE dedupe_key = p_dedupe;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer_events:' || p_customer::text, 0));
  SELECT id INTO v_id FROM customer_events WHERE dedupe_key = p_dedupe;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT event_hash INTO v_prev FROM customer_events
   WHERE customer_id = p_customer ORDER BY id DESC LIMIT 1;
  v_hash := encode(sha256(convert_to(concat_ws('|',
    COALESCE(v_prev, ''), p_customer::text, to_char(p_occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    p_source, p_type, p_actor_type, COALESCE(p_actor::text, ''), COALESCE(p_entity_type, ''),
    COALESCE(p_entity_id, ''), v_changes::text, p_dedupe), 'UTF8')), 'hex');
  INSERT INTO customer_events (customer_id, occurred_at, source, event_type, actor_type, actor_id,
    entity_type, entity_id, changes, dedupe_key, previous_hash, event_hash)
  VALUES (p_customer, p_occurred, p_source, left(p_type, 120), p_actor_type, p_actor,
    left(p_entity_type, 60), left(p_entity_id, 160), v_changes, left(p_dedupe, 255), v_prev, v_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Diff two audit states, keeping only non-personal scalar values.
CREATE OR REPLACE FUNCTION customer_event_redact_diff(p_before JSONB, p_after JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  WITH b AS (SELECT CASE WHEN jsonb_typeof(p_before) = 'object' THEN p_before ELSE '{}'::jsonb END AS v),
       a AS (SELECT CASE WHEN jsonb_typeof(p_after) = 'object' THEN p_after ELSE '{}'::jsonb END AS v),
       keys AS (
         SELECT k FROM (SELECT jsonb_object_keys((SELECT v FROM b)) AS k
                        UNION SELECT jsonb_object_keys((SELECT v FROM a))) s
         WHERE ((SELECT v FROM b) -> k) IS DISTINCT FROM ((SELECT v FROM a) -> k)
         ORDER BY k LIMIT 40)
  SELECT COALESCE(jsonb_object_agg(k,
    CASE
      WHEN k ~* '(email|phone|name|address|street|zip|postal|password|token|secret|ssn|tax|dob|birth|ip|agent|card|account_number|iban|routing|note|description|reason|message|content|body|comment|text|holder|fingerprint|geo|lat|lng|location)'
        THEN jsonb_build_object('changed', true, 'redacted', true)
      WHEN jsonb_typeof((SELECT v FROM b) -> k) IN ('object', 'array')
        OR jsonb_typeof((SELECT v FROM a) -> k) IN ('object', 'array')
        THEN jsonb_build_object('changed', true)
      WHEN length(COALESCE(((SELECT v FROM b) ->> k), '')) > 80 OR length(COALESCE(((SELECT v FROM a) ->> k), '')) > 80
        THEN jsonb_build_object('changed', true)
      ELSE jsonb_build_object('from', (SELECT v FROM b) -> k, 'to', (SELECT v FROM a) -> k)
    END), '{}'::jsonb)
  FROM keys;
$$;

-- ── Source triggers (outbox writers) ──────────────────────────────────
CREATE OR REPLACE FUNCTION customer_event_capture()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_uuid_re CONSTANT TEXT := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  -- Transition keys carry the transaction id and a microsecond clock so a
  -- status that is re-entered later (open -> pending -> open) is recorded
  -- again, while a retried drain still collapses on the same key.
  IF TG_TABLE_NAME = 'admin_audit_log' THEN
    IF NEW.target_type = 'user' AND NEW.target_id ~ v_uuid_re THEN
      INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id,
        entity_type, entity_id, changes, dedupe_key)
      VALUES (NEW.target_id::uuid, NEW.created_at, 'admin_audit', 'admin.' || left(NEW.action, 110),
        CASE WHEN NEW.admin_id IS NULL THEN 'system' ELSE 'admin' END, NEW.admin_id,
        'admin_action', NEW.id::text, customer_event_redact_diff(NEW.before_state, NEW.after_state),
        'admin_audit:' || NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'user_login_history' THEN
    IF NEW.user_id IS NOT NULL THEN
      INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id,
        entity_type, entity_id, changes, dedupe_key)
      VALUES (NEW.user_id, COALESCE(NEW.login_at, NEW.created_at, NOW()), 'login',
        CASE WHEN NEW.success THEN 'login.succeeded' ELSE 'login.failed' END, 'customer', NEW.user_id,
        'login', NEW.id::text, jsonb_strip_nulls(jsonb_build_object('country', NEW.country_code)),
        'login:' || NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id,
        entity_type, entity_id, changes, dedupe_key)
      SELECT p.uid, COALESCE(NEW.updated_at, NOW()), 'payment', 'payment.' || COALESCE(NEW.status, 'unknown'),
        'system', NULL, 'payment', NEW.id::text,
        jsonb_build_object('status', jsonb_build_object('from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.status) END, 'to', to_jsonb(NEW.status)),
                           'role', p.role),
        'payment:' || NEW.id || ':' || COALESCE(NEW.status, '') || ':' || p.uid || ':' || txid_current() || '.' || (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
      FROM (VALUES (NEW.payer_id, 'payer'), (NEW.payee_id, 'payee')) AS p(uid, role)
      WHERE p.uid IS NOT NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'support_tickets' THEN
    IF NEW.user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id,
        entity_type, entity_id, changes, dedupe_key)
      VALUES (NEW.user_id, COALESCE(NEW.updated_at, NOW()), 'support', 'support_ticket.' || COALESCE(NEW.status, 'unknown'),
        CASE WHEN TG_OP = 'INSERT' THEN 'customer' ELSE 'system' END, CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id END,
        'support_ticket', NEW.id::text,
        jsonb_build_object('status', jsonb_build_object('from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.status) END, 'to', to_jsonb(NEW.status))),
        'support_ticket:' || NEW.id || ':' || COALESCE(NEW.status, '') || ':' || txid_current() || '.' || (extract(epoch FROM clock_timestamp()) * 1000000)::bigint);
    END IF;
  ELSIF TG_TABLE_NAME = 'food_orders' THEN
    IF NEW.customer_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.payment_status IS DISTINCT FROM OLD.payment_status) THEN
      INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id,
        entity_type, entity_id, changes, dedupe_key)
      VALUES (NEW.customer_id, COALESCE(NEW.updated_at, NOW()), 'food_order', 'food_order.' || COALESCE(NEW.status, 'unknown'),
        'system', NULL, 'food_order', NEW.id::text,
        jsonb_build_object(
          'status', jsonb_build_object('from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.status) END, 'to', to_jsonb(NEW.status)),
          'payment_status', jsonb_build_object('from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.payment_status) END, 'to', to_jsonb(NEW.payment_status))),
        'food_order:' || NEW.id || ':' || COALESCE(NEW.status, '') || ':' || COALESCE(NEW.payment_status, '') || ':' || txid_current() || '.' || (extract(epoch FROM clock_timestamp()) * 1000000)::bigint);
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- The event log must never break the source write. A missed capture is
  -- repaired by the backfill walk; log it for operators.
  RAISE WARNING 'customer_event_capture skipped for %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('admin_audit_log', 'AFTER INSERT'),
    ('user_login_history', 'AFTER INSERT'),
    ('payments', 'AFTER INSERT OR UPDATE OF status'),
    ('support_tickets', 'AFTER INSERT OR UPDATE OF status'),
    ('food_orders', 'AFTER INSERT OR UPDATE OF status, payment_status')
  ) AS s(tbl, timing) LOOP
    IF to_regclass(spec.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', spec.tbl || '_customer_event', spec.tbl);
      EXECUTE format('CREATE TRIGGER %I %s ON %I FOR EACH ROW EXECUTE FUNCTION customer_event_capture()',
        spec.tbl || '_customer_event', spec.timing, spec.tbl);
    END IF;
  END LOOP;
END;
$$;
