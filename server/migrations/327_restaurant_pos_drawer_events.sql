-- Migration 327: POS cash drawer event ledger.
-- Adds auditable paid-in/out, drops, no-sale, and drawer count events for POS shifts.

CREATE TABLE IF NOT EXISTS restaurant_pos_drawer_events (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  shift_id BIGINT NOT NULL REFERENCES restaurant_pos_shifts(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL
    CHECK (event_type IN ('cash_in','cash_out','cash_drop','no_sale','drawer_count','payout')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  reason VARCHAR(160),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_drawer_events_shift
  ON restaurant_pos_drawer_events(restaurant_id, shift_id, created_at DESC);

