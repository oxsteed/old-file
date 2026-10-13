BEGIN;

-- P2-4-F08: runner cash collection was self-reported with no remittance
-- reconciliation. cash_collected_cents is the runner's self-report; the new
-- cash_remitted_cents is manager-recorded (what the runner actually handed
-- back to the drawer). The application requires remittance to cover reported
-- cash before a settlement can be marked paid.
ALTER TABLE restaurant_runner_settlements
  ADD COLUMN IF NOT EXISTS cash_remitted_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remitted_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'restaurant_runner_settlements_remitted_ck'
  ) THEN
    ALTER TABLE restaurant_runner_settlements
      ADD CONSTRAINT restaurant_runner_settlements_remitted_ck
      CHECK (cash_remitted_cents >= 0);
  END IF;
END $$;

COMMIT;
