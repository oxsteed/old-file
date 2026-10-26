-- F-08: offline card (Stripe Terminal store-and-forward) for real outages.
-- A paired POS takes a bounded lease while online; during an outage the
-- native app collects offline payments against it and registers each one on
-- reconnect. Over-limit or mismatched payments are recorded for review,
-- never dropped, because the card has already been charged.
CREATE TABLE IF NOT EXISTS restaurant_terminal_offline_leases (
  id UUID PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id),
  device_id BIGINT NOT NULL REFERENCES restaurant_devices(id),
  shift_id BIGINT NOT NULL REFERENCES restaurant_pos_shifts(id),
  provider_account_id TEXT NOT NULL,
  currency_code VARCHAR(3) NOT NULL,
  business_date DATE NOT NULL,
  budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
  max_transaction_cents INTEGER NOT NULL CHECK (max_transaction_cents > 0),
  allowed_card_brands TEXT[] NOT NULL,
  consumed_cents INTEGER NOT NULL DEFAULT 0 CHECK (consumed_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_terminal_offline_lease_active
  ON restaurant_terminal_offline_leases(device_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS restaurant_terminal_offline_lease_day
  ON restaurant_terminal_offline_leases(restaurant_id, location_id, business_date);

CREATE TABLE IF NOT EXISTS restaurant_terminal_offline_payments (
  offline_id UUID PRIMARY KEY,
  lease_id UUID NOT NULL REFERENCES restaurant_terminal_offline_leases(id),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id),
  screen_ticket_id UUID,
  food_order_id BIGINT REFERENCES food_orders(id),
  provider_payment_intent_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  collected_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded','attached','requires_reconciliation','declined','voided')),
  review_reasons TEXT[] NOT NULL DEFAULT '{}',
  resolved_by UUID REFERENCES users(id),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS restaurant_terminal_offline_payment_open
  ON restaurant_terminal_offline_payments(restaurant_id, status) WHERE status IN ('recorded','requires_reconciliation');

ALTER TABLE restaurant_terminal_offline_permits ADD COLUMN IF NOT EXISTS lease_id UUID REFERENCES restaurant_terminal_offline_leases(id);
ALTER TABLE restaurant_terminal_offline_permits ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
