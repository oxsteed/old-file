-- Migration 365: Allow in-app confirmation of direct payment receipts.
--
-- This keeps the main app aligned with the long-term payment model:
-- restaurant credit remains native, direct payments can be recorded, and the
-- recipient can confirm receipt in-app without creating a processor charge.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'main_app_payment_requests_status_check'
  ) THEN
    ALTER TABLE main_app_payment_requests
      DROP CONSTRAINT main_app_payment_requests_status_check;
  END IF;
END $$;

ALTER TABLE main_app_payment_requests
  ADD CONSTRAINT main_app_payment_requests_status_check
  CHECK (status IN ('requested', 'viewed', 'cancelled', 'expired', 'processor_pending', 'authorized', 'settled', 'failed', 'confirmed'));

