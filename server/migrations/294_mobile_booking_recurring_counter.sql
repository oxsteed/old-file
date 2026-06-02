-- Mobile recurring bookings and booking counter-proposals.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS counter_proposed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS counter_date DATE,
  ADD COLUMN IF NOT EXISTS counter_start_time TIME,
  ADD COLUMN IF NOT EXISTS counter_end_time TIME,
  ADD COLUMN IF NOT EXISTS counter_message TEXT,
  ADD COLUMN IF NOT EXISTS counter_status VARCHAR(20)
    CHECK (counter_status IS NULL OR counter_status IN ('pending', 'accepted', 'declined'));

CREATE TABLE IF NOT EXISTS recurring_booking_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_name VARCHAR(255) NOT NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  preferred_day VARCHAR(20),
  preferred_time TIME,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),
  next_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_booking_customer
  ON recurring_booking_subscriptions(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_recurring_booking_helper
  ON recurring_booking_subscriptions(helper_id, status);
