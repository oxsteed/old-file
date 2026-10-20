-- 948_restaurant_staff_sessions_approvals_timeclock.sql
-- Staff-management review S-06, S-07, S-05.
--
-- S-06: shared POS devices get real staff identity. restaurant_staff_pins
-- gains a deterministic per-restaurant PIN digest so a PIN value can be
-- unique per store (bcrypt hashes are salted and cannot be unique-indexed),
-- PIN attempts are recorded for lockout, and restaurant_staff_sessions
-- holds the short-lived staff sub-sessions a validated PIN issues.
-- Orders, POS payments, drawer events and receipt audits gain an
-- acting_staff_user_id stamp: the account session says who owns the
-- device login, the stamp says which staff member actually acted.
--
-- S-07: restaurant_pos_approvals records manager-PIN approvals
-- (requester, approver, reason, amount) for drawer payouts/cash-outs/
-- no-sales, voids, refunds and comps above per-restaurant thresholds.
--
-- S-05: business_time_entries gains a real punch model (clock_in_at,
-- clock_out_at, breaks) next to the legacy manual-hours columns, plus an
-- append-only edit audit table. hours_worked becomes nullable so an open
-- punch can exist before its hours are computed at clock-out; the legacy
-- <= 24 cap is dropped because a forgotten clock-out must still be
-- closable (the value stays > 0 when present).

-- ---------------------------------------------------------------------------
-- S-06: PIN digest, attempts, sessions
-- ---------------------------------------------------------------------------

ALTER TABLE restaurant_staff_pins
  ADD COLUMN IF NOT EXISTS pin_digest TEXT;

-- One active PIN value per restaurant. Label-only PINs (staff_user_id NULL)
-- are covered too: the digest does not depend on the owner columns, unlike
-- the legacy UNIQUE (restaurant_id, staff_user_id), which treats NULL owners
-- as distinct and let duplicate label PINs pile up. Legacy rows keep a NULL
-- digest (a bcrypt hash cannot be reversed into one) and are exempt until
-- the PIN is next set, which always writes the digest.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_staff_pins_restaurant_digest
  ON restaurant_staff_pins (restaurant_id, pin_digest)
  WHERE is_active = TRUE AND pin_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_staff_pin_attempts (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  staff_pin_id BIGINT REFERENCES restaurant_staff_pins(id) ON DELETE SET NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_staff_pin_attempts_device
  ON restaurant_staff_pin_attempts (restaurant_id, device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_staff_pin_attempts_pin
  ON restaurant_staff_pin_attempts (restaurant_id, staff_pin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_staff_sessions (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  staff_pin_id BIGINT NOT NULL REFERENCES restaurant_staff_pins(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  end_reason VARCHAR(40),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_restaurant_staff_sessions_restaurant
  ON restaurant_staff_sessions (restaurant_id, staff_pin_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- S-06: acting staff stamps
-- ---------------------------------------------------------------------------

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS acting_staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE restaurant_pos_payments
  ADD COLUMN IF NOT EXISTS acting_staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE restaurant_pos_drawer_events
  ADD COLUMN IF NOT EXISTS acting_staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE restaurant_pos_receipt_events
  ADD COLUMN IF NOT EXISTS acting_staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- S-07: manager-PIN approvals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS restaurant_pos_approvals (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL
    CHECK (action IN ('payout', 'cash_out', 'no_sale', 'void', 'refund', 'comp')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  requester_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  requester_staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approver_staff_pin_id BIGINT REFERENCES restaurant_staff_pins(id) ON DELETE SET NULL,
  reason_code VARCHAR(60),
  reason TEXT,
  shift_id BIGINT REFERENCES restaurant_pos_shifts(id) ON DELETE SET NULL,
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  payment_id BIGINT REFERENCES restaurant_pos_payments(id) ON DELETE SET NULL,
  drawer_event_id BIGINT REFERENCES restaurant_pos_drawer_events(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'denied', 'consumed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_approvals_restaurant
  ON restaurant_pos_approvals (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_pos_approvals_requester
  ON restaurant_pos_approvals (restaurant_id, requester_staff_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- S-05: time-entry punch model + append-only edit audit
-- ---------------------------------------------------------------------------

ALTER TABLE business_time_entries
  ADD COLUMN IF NOT EXISTS clock_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clock_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS breaks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS punch_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE business_time_entries
  ALTER COLUMN hours_worked DROP NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'business_time_entries_hours_worked_check'
       AND conrelid = 'business_time_entries'::regclass
  ) THEN
    ALTER TABLE business_time_entries
      DROP CONSTRAINT business_time_entries_hours_worked_check;
    ALTER TABLE business_time_entries
      ADD CONSTRAINT business_time_entries_hours_worked_check
      CHECK (hours_worked IS NULL OR hours_worked > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bte_open_punch
  ON business_time_entries (business_id, user_id)
  WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL AND voided_at IS NULL;

CREATE TABLE IF NOT EXISTS business_time_entry_edits (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES business_time_entries(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  editor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  field VARCHAR(40) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_btee_entry
  ON business_time_entry_edits (entry_id, created_at ASC);
