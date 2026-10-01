-- Migration 626: idempotency for affiliate payout calculation (audit M8)
-- + staff no-double-booking backstop for business appointments (audit M11).
-- Workstream 6 of the 20-agent audit remediation.
--
-- M8: calculateAndCreatePayout had no idempotency key and no row-level claim,
-- so a concurrent double-submit could create two affiliate_payouts rows
-- against the same set of pending commissions. The controller now derives a
-- deterministic idempotency key per (program, period) (honoring a
-- client-supplied Idempotency-Key / idempotencyKey when present) and takes a
-- FOR UPDATE claim on the affiliate_programs row inside the transaction,
-- serializing concurrent calculate calls for the same program.
--
-- M11: business_appointments create was check-then-insert with no DB backstop
-- and staff double-booking was possible across services. The exclusion
-- constraint below is the database-level backstop; the controller also takes
-- row claims and returns friendly 409s. The inner EXCEPTION guard keeps the
-- migration deploy-safe if a legacy database already holds overlapping rows
-- (the skip is logged as a WARNING and reported in the remediation report).

ALTER TABLE affiliate_payouts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial unique index: only keyed rows participate, so legacy rows with
-- NULL keys are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_payouts_idempotency_key
  ON affiliate_payouts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ba_no_staff_double_booking') THEN
    BEGIN
      ALTER TABLE business_appointments
        ADD CONSTRAINT ba_no_staff_double_booking
        EXCLUDE USING gist (
          staff_id WITH =,
          tstzrange(start_time, end_time) WITH &&
        )
        WHERE (staff_id IS NOT NULL AND status <> 'cancelled');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'migration 626: ba_no_staff_double_booking skipped: %', SQLERRM;
    END;
  END IF;
END
$$;
