-- Migration 808: record (never auto-charge) late-cancellation fees on business appointments.
--
-- Business services carry cancellation_policy_hours / cancellation_fee_percent,
-- and cancelAppointment now enforces them: a cancellation inside the policy
-- window records cancellation_fee_cents as an amount due. The server never
-- charges it automatically; the business collects it directly. Money code
-- fails closed: recording a due amount is not moving money.

BEGIN;

ALTER TABLE business_appointments
  ADD COLUMN IF NOT EXISTS cancellation_fee_cents INTEGER NOT NULL DEFAULT 0;

COMMIT;
