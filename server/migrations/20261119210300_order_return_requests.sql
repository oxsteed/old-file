-- Group 1 (Customer, item 35): product return entry.
--
-- A customer records a return request against one of their marketplace
-- orders. Recording the request does NOT issue a refund: refunds stay
-- in the existing money-approvals flow (admin / dual approval), and a
-- return request only moves to 'refunded' when that flow records one.
-- One open return request per order: a second request while one is open
-- is refused by the API (partial unique index below).
CREATE TABLE IF NOT EXISTS order_return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  admin_note TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_return_requests_status_check'
      AND conrelid = 'order_return_requests'::regclass
  ) THEN
    ALTER TABLE order_return_requests
      ADD CONSTRAINT order_return_requests_status_check
      CHECK (status IN ('requested', 'approved', 'declined', 'refunded', 'cancelled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_return_requests_one_open
  ON order_return_requests (order_id)
  WHERE status IN ('requested', 'approved');
CREATE INDEX IF NOT EXISTS idx_order_return_requests_user
  ON order_return_requests (user_id, created_at DESC);
