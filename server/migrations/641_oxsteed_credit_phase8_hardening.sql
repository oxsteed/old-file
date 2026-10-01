-- Migration 641: OxSteed Credit Phase 8 hardening (sweeper index, chargeback
-- dispute type, journal status truth-in-advertising).
--
-- 1. Top-up expiry sweeper index: the sweeper scans for pending top-ups past
--    their expires_at. The partial index matches that query exactly.
-- 2. Dispute type 'chargeback': Stripe chargeback ingestion opens system
--    disputes on the linked top-up journal transaction. The named CHECK from
--    migration 640 is widened defensively (drop + re-add only when it lacks
--    the value) so re-runs are no-ops.
-- 3. Journal status narrowing: oxsteed_credit_transactions.status is
--    append-only and the only value ever written is 'posted' (the single
--    INSERT in postJournalTransaction hardcodes it; no UPDATE of the column
--    exists in non-test code and no migration ever wrote another value).
--    The old CHECK named four states the ledger can never hold; it is
--    narrowed to the actually-written state. The migration 465 triggers
--    (oxsteed_credit_transaction_status_guard,
--    oxsteed_credit_posted_entry_guard) are intentionally untouched.

-- ── 1. Top-up expiry sweeper index ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_topups_expires_at
  ON oxsteed_credit_topups (expires_at)
  WHERE status = 'pending';

-- ── 2. Widen the dispute_type CHECK with 'chargeback' ──────────────────────
DO $$
DECLARE
  check_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO check_def
    FROM pg_constraint
   WHERE conrelid = 'oxsteed_credit_disputes'::regclass
     AND conname = 'oxsteed_credit_disputes_dispute_type_check';
  IF check_def IS NOT NULL AND check_def NOT LIKE '%chargeback%' THEN
    ALTER TABLE oxsteed_credit_disputes
      DROP CONSTRAINT oxsteed_credit_disputes_dispute_type_check;
    ALTER TABLE oxsteed_credit_disputes
      ADD CONSTRAINT oxsteed_credit_disputes_dispute_type_check
      CHECK (dispute_type IS NULL OR dispute_type IN (
        'unauthorized_topup', 'failed_payout', 'duplicate_charge',
        'incorrect_amount', 'chargeback'
      ));
  END IF;
END;
$$;

-- ── 3. Narrow the journal status CHECK to the only written state ───────────
DO $$
DECLARE
  status_check_name TEXT;
BEGIN
  -- The original inline CHECK has a generated name; look it up by
  -- table + column instead of hardcoding it. The known narrowed name is
  -- excluded so re-runs are no-ops.
  SELECT c.conname INTO status_check_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'oxsteed_credit_transactions'::regclass
     AND c.contype = 'c'
     AND a.attname = 'status'
     AND c.conname <> 'oxsteed_credit_transactions_status_posted_check'
   LIMIT 1;
  IF status_check_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE oxsteed_credit_transactions DROP CONSTRAINT %I',
      status_check_name
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oxsteed_credit_transactions'::regclass
       AND conname = 'oxsteed_credit_transactions_status_posted_check'
  ) THEN
    ALTER TABLE oxsteed_credit_transactions
      ADD CONSTRAINT oxsteed_credit_transactions_status_posted_check
      CHECK (status IN ('posted'));
  END IF;
END;
$$;
