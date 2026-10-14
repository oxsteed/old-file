-- Migration 855: Restaurant credit dispute resolution (Phase 1).
-- When a restaurant cancels a customer wallet load request after the customer
-- paid off-platform, the customer can open a dispute within 48h of the
-- cancellation. Restaurants respond with evidence; admins resolve. Resolving
-- with 'resolved_release' re-queues the load request to pending for
-- restaurant re-review (it never auto-credits: money moves only through the
-- restaurant's normal approval path).

CREATE TABLE IF NOT EXISTS food_credit_disputes (
  id BIGSERIAL PRIMARY KEY,
  load_request_id BIGINT NOT NULL REFERENCES food_customer_wallet_load_requests(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  reason VARCHAR(500) NOT NULL,
  customer_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  restaurant_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'resolved_release', 'resolved_deny', 'resolved_info_needed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_food_credit_disputes_load_request UNIQUE (load_request_id)
);

CREATE INDEX IF NOT EXISTS idx_food_credit_disputes_restaurant_status
  ON food_credit_disputes (restaurant_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_credit_disputes_customer_status
  ON food_credit_disputes (customer_id, status, opened_at DESC);

CREATE OR REPLACE FUNCTION trg_touch_food_credit_disputes()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_food_credit_disputes_updated_at'
  ) THEN
    CREATE TRIGGER trg_food_credit_disputes_updated_at
      BEFORE UPDATE ON food_credit_disputes
      FOR EACH ROW
      EXECUTE FUNCTION trg_touch_food_credit_disputes();
  END IF;
END $$;

COMMENT ON TABLE food_credit_disputes IS
  'Customer disputes for cancelled restaurant wallet credit load requests. One dispute per load request; resolution never auto-credits.';
