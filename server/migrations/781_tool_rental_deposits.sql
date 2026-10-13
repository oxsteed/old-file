-- Review P3-1068: tool-rental deposits become real ledger items. The owner
-- collects the deposit with the rental (it is a separate invoice line), confirms
-- receipt, and records returning or withholding it with a reason.
ALTER TABLE tool_rental_invoices
  ADD COLUMN IF NOT EXISTS rental_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS deposit_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status          VARCHAR(24) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS deposit_withheld_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS deposit_received_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_resolved_at     TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_rentals_bookings_deposit_status_check') THEN
    ALTER TABLE tool_rentals_bookings ADD CONSTRAINT tool_rentals_bookings_deposit_status_check
      CHECK (deposit_status IN ('none', 'due', 'held', 'returned', 'partially_withheld', 'withheld'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_rentals_bookings_deposit_withheld_check') THEN
    ALTER TABLE tool_rentals_bookings ADD CONSTRAINT tool_rentals_bookings_deposit_withheld_check
      CHECK (deposit_withheld_amount IS NULL OR (deposit_withheld_amount >= 0 AND deposit_withheld_amount <= deposit_amount));
  END IF;
END $$;
