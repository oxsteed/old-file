-- Migration 640: OxSteed Credit governance (Phase 7: gaps 9, 10, 11).
--
-- Code machinery only. Legal sign-off, licensing, regulatory filings, and
-- vendor contracts are NOT part of this migration (documented, not faked).
--
-- 1. Maker-checker (dual approval): oxsteed_credit_pending_actions. A money
--    movement requested by one super-admin (maker) sits as a pending action
--    until a DIFFERENT super-admin (checker) approves or rejects it. The
--    checker approval runs the registered executor inside the same decision
--    transaction that flips the status, so a second approval cannot
--    re-execute; a repeat approval after a successful execution returns the
--    stored execution refs as a no-op.
-- 2. Dispute automation: dispute_type / sla_due_at / resolution_entries on
--    oxsteed_credit_disputes, plus the compensated-resolution statuses
--    resolved_customer / resolved_merchant (legacy 'resolved' stays a
--    terminal state for old rows). The 452/463/493 trigger guards are
--    extended for the new statuses; nullable columns do not disturb them.
-- 3. reserved_cents guard: oxsteed_credit_reservations is the source of
--    truth for non-hold reservations (withdrawals, settlement payouts).
--    Holds keep their existing table; reconciliation UNIONs both sources.
-- 4. Step-up challenge action types: widen the 638 CHECK to the action
--    types the JS allowlist already issues ('withdrawal',
--    'customer_transfer', 'restaurant_conversion') plus the new
--    'pending_action_approve' used by checker approvals. Without this the
--    DB would reject challenges the code is already allowed to issue.

-- ── 1. Pending actions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oxsteed_credit_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type VARCHAR(60) NOT NULL,
  payload JSONB NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  execution_refs JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_credit_pending_actions_status_expiry
  ON oxsteed_credit_pending_actions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_credit_pending_actions_requested_by
  ON oxsteed_credit_pending_actions(requested_by);

-- ── 2. Reservations (non-hold) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oxsteed_credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  reservation_type VARCHAR(40) NOT NULL,
  reference_type VARCHAR(60) NOT NULL,
  reference_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  released_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_account_status
  ON oxsteed_credit_reservations(account_id, status);
-- One live reservation per business reference (a withdrawal or a payout
-- reserves exactly once; a second reserve is a bug, not a feature).
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_reservations_active_reference
  ON oxsteed_credit_reservations(reference_type, reference_id)
  WHERE status = 'active';

-- ── 3. Dispute columns ───────────────────────────────────────────────────
ALTER TABLE oxsteed_credit_disputes
  ADD COLUMN IF NOT EXISTS dispute_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_entries JSONB NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oxsteed_credit_disputes'::regclass
       AND conname = 'oxsteed_credit_disputes_dispute_type_check'
  ) THEN
    ALTER TABLE oxsteed_credit_disputes
      ADD CONSTRAINT oxsteed_credit_disputes_dispute_type_check
      CHECK (dispute_type IS NULL OR dispute_type IN (
        'unauthorized_topup', 'failed_payout', 'duplicate_charge', 'incorrect_amount'
      ));
  END IF;
END;
$$;

-- Widen the status CHECK for the compensated-resolution statuses. The old
-- inline CHECK has a generated name; find and replace it deterministically.
DO $$
DECLARE
  status_check_name TEXT;
BEGIN
  SELECT conname INTO status_check_name
    FROM pg_constraint
   WHERE conrelid = 'oxsteed_credit_disputes'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%in_review%'
     AND pg_get_constraintdef(oid) LIKE '%status%'
   LIMIT 1;
  IF status_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE oxsteed_credit_disputes DROP CONSTRAINT %I', status_check_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oxsteed_credit_disputes'::regclass
       AND conname = 'oxsteed_credit_disputes_status_check'
  ) THEN
    ALTER TABLE oxsteed_credit_disputes
      ADD CONSTRAINT oxsteed_credit_disputes_status_check
      CHECK (status IN (
        'open', 'in_review',
        'resolved', 'rejected',
        'resolved_customer', 'resolved_merchant'
      ));
  END IF;
END;
$$;

-- 452 integrity guard: treat the new compensated statuses as closed states
-- (resolution evidence required, never reopenable). The service layer
-- enforces the stricter open -> in_review -> terminal map; the trigger
-- stays a backstop and keeps the legacy open -> resolved/rejected path for
-- rows resolved before Phase 7.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_dispute_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_partner_id BIGINT;
  transaction_currency CHAR(3);
  transaction_status VARCHAR(20);
  customer_owns_transaction BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit dispute ownership cannot change after it is opened'
      USING ERRCODE = '23514';
  END IF;

  SELECT t.partner_id, t.currency_code, t.status
    INTO transaction_partner_id, transaction_currency, transaction_status
    FROM oxsteed_credit_transactions t
   WHERE t.id = NEW.transaction_id;

  IF transaction_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'OxSteed Credit disputes require a posted transaction'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM oxsteed_credit_accounts a
      JOIN users u ON u.id = a.customer_id
     WHERE a.id IN (
       SELECT t.debit_account_id
         FROM oxsteed_credit_transactions t
        WHERE t.id = NEW.transaction_id
       UNION
       SELECT t.credit_account_id
         FROM oxsteed_credit_transactions t
        WHERE t.id = NEW.transaction_id
     )
       AND a.account_type = 'customer_wallet'
       AND a.customer_id = NEW.customer_id
       AND a.currency_code IS NOT DISTINCT FROM transaction_currency
       AND u.role = 'customer'
  )
    INTO customer_owns_transaction;

  IF NOT customer_owns_transaction THEN
    RAISE EXCEPTION 'OxSteed Credit dispute customer does not own the transaction'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.partner_id IS DISTINCT FROM transaction_partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit dispute partner does not match the transaction'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'open' AND NEW.status IN ('in_review', 'resolved', 'rejected', 'resolved_customer', 'resolved_merchant'))
      OR (OLD.status = 'in_review' AND NEW.status IN ('resolved', 'rejected', 'resolved_customer', 'resolved_merchant'))
    ) THEN
      RAISE EXCEPTION 'Invalid OxSteed Credit dispute status transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('resolved', 'rejected', 'resolved_customer', 'resolved_merchant') THEN
    IF NULLIF(BTRIM(NEW.resolution), '') IS NULL
       OR NEW.resolved_by IS NULL
       OR NEW.resolved_at IS NULL THEN
      RAISE EXCEPTION 'A closed OxSteed Credit dispute requires resolution evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_dispute_integrity_guard ON oxsteed_credit_disputes;

CREATE TRIGGER oxsteed_credit_dispute_integrity_guard
  BEFORE INSERT OR UPDATE
  ON oxsteed_credit_disputes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_dispute_integrity();

-- 463 status-evidence guard: compensated resolutions need a note too.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_dispute_status_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('in_review', 'resolved', 'rejected', 'resolved_customer', 'resolved_merchant')
     AND NULLIF(BTRIM(NEW.resolution), '') IS NULL THEN
    RAISE EXCEPTION 'A Credit dispute status change requires a note'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_dispute_status_evidence_guard ON oxsteed_credit_disputes;

CREATE TRIGGER oxsteed_credit_dispute_status_evidence_guard
  BEFORE INSERT OR UPDATE OF status, resolution
  ON oxsteed_credit_disputes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_dispute_status_evidence();

-- 493 actor-evidence guard: compensated resolutions must carry an active
-- administrator identity, like the legacy closed states.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_dispute_actor_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  opened_by_valid BOOLEAN;
  resolved_by_valid BOOLEAN;
  actor_changed BOOLEAN := TG_OP = 'INSERT';
  status_changed BOOLEAN := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    actor_changed := NEW.resolved_by IS DISTINCT FROM OLD.resolved_by;
    status_changed := NEW.status IS DISTINCT FROM OLD.status;

    IF OLD.actor_evidence_legacy AND NOT NEW.actor_evidence_legacy THEN
      RAISE EXCEPTION 'Legacy Credit dispute actor evidence cannot be cleared'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.resolved_by IS NOT NULL AND NEW.resolved_by IS DISTINCT FROM OLD.resolved_by THEN
      RAISE EXCEPTION 'Resolved Credit dispute actor cannot change after assignment'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
      RAISE EXCEPTION 'Resolved Credit dispute timestamp cannot change after closure'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.opened_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM users u
       WHERE u.id = NEW.opened_by
         AND u.role = 'customer'
         AND u.is_active = TRUE
    ) INTO opened_by_valid;
  ELSE
    opened_by_valid := FALSE;
  END IF;

  IF NOT opened_by_valid AND (TG_OP = 'INSERT' OR NOT NEW.actor_evidence_legacy) THEN
    RAISE EXCEPTION 'New OxSteed Credit disputes require an active customer opener'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolved_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM users u
       WHERE u.id = NEW.resolved_by
         AND u.role IN ('admin', 'super_admin')
         AND u.is_active = TRUE
    ) INTO resolved_by_valid;
  ELSE
    resolved_by_valid := FALSE;
  END IF;

  IF NEW.resolved_by IS NOT NULL AND (actor_changed OR NOT NEW.actor_evidence_legacy) AND NOT resolved_by_valid THEN
    RAISE EXCEPTION 'New OxSteed Credit dispute resolutions require an active administrator'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('resolved', 'rejected', 'resolved_customer', 'resolved_merchant')
     AND (status_changed OR TG_OP = 'INSERT')
     AND NOT resolved_by_valid THEN
    RAISE EXCEPTION 'Closing an OxSteed Credit dispute requires an active administrator identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_dispute_actor_evidence_guard ON oxsteed_credit_disputes;

CREATE TRIGGER oxsteed_credit_dispute_actor_evidence_guard
  BEFORE INSERT OR UPDATE OF opened_by, resolved_by, resolved_at, status, actor_evidence_legacy
  ON oxsteed_credit_disputes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_dispute_actor_evidence();

-- Backfill the legacy-marker sweep from 493 for rows closed with the new
-- statuses before this migration ran (none should exist, but stay correct).
UPDATE oxsteed_credit_disputes d
   SET actor_evidence_legacy = TRUE
 WHERE d.actor_evidence_legacy = FALSE
   AND d.status IN ('resolved_customer', 'resolved_merchant')
   AND (
     d.resolved_by IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM users u
        WHERE u.id = d.resolved_by
          AND u.role IN ('admin', 'super_admin')
     )
   );

-- ── 4. Step-up challenge action types ────────────────────────────────────
-- Widen the 638 CHECK to every action type the service allowlist issues.
DO $$
DECLARE
  stepup_check_name TEXT;
BEGIN
  SELECT conname INTO stepup_check_name
    FROM pg_constraint
   WHERE conrelid = 'oxsteed_credit_stepup_challenges'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%settlement_payout%'
   LIMIT 1;
  IF stepup_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE oxsteed_credit_stepup_challenges DROP CONSTRAINT %I', stepup_check_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oxsteed_credit_stepup_challenges'::regclass
       AND conname = 'oxsteed_credit_stepup_challenges_action_type_check'
  ) THEN
    ALTER TABLE oxsteed_credit_stepup_challenges
      ADD CONSTRAINT oxsteed_credit_stepup_challenges_action_type_check
      CHECK (action_type IN (
        'topup', 'settlement_payout', 'withdrawal',
        'customer_transfer', 'restaurant_conversion',
        'pending_action_approve'
      ));
  END IF;
END;
$$;
