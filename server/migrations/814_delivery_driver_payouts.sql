BEGIN;

-- P2-4-F04: parcel-delivery driver payouts did not exist. Customer collection
-- (localDeliveryPaymentService) was the only money rail, so drivers could
-- claim and complete paid deliveries with no payout lifecycle. This adds the
-- accrual ledger. Payouts accrue automatically on job delivery, but money only
-- moves through explicit ops approval + a recorded payment reference; the
-- 'paid' state is never reached automatically. Fails closed: no payout row is
-- created for cancelled/returned jobs, and amounts come only from the job's
-- quoted driver_payout_cents (never request input).
CREATE TABLE IF NOT EXISTS delivery_driver_payouts (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL UNIQUE REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_cents INTEGER NOT NULL CHECK (payout_cents > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'accrued'
    CHECK (status IN ('accrued','approved','paid','voided')),
  note TEXT,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payment_reference VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_driver_payouts_driver
  ON delivery_driver_payouts(driver_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_driver_payouts_status
  ON delivery_driver_payouts(status, created_at DESC);

-- Guard the paid state: a payout may only be marked paid with a recorded
-- payment reference. The application enforces this too; the constraint is
-- defense in depth against raw SQL edits.
ALTER TABLE delivery_driver_payouts
  ADD CONSTRAINT delivery_driver_payouts_paid_reference_ck
  CHECK (status <> 'paid' OR (payment_reference IS NOT NULL AND btrim(payment_reference) <> ''));

COMMIT;
