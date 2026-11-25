-- Gaps batch (394, D-436): emergency closure must refuse to pause until every
-- open order has a disposition recorded and the customer notice is recorded.
-- The closures table stored neither, so both are added here.
--
-- Additive only; safe to run twice (IF NOT EXISTS throughout). Existing rows
-- keep NULL notice fields (closes made before this rule carry no notice) and
-- no disposition rows (nothing was recorded). Nothing here moves money;
-- dispositions and the notice are coordination records only: recording a
-- 'cancel' disposition does not cancel the order or refund anything, and the
-- notice is a notification, not a payment.
ALTER TABLE restaurant_location_closures
  ADD COLUMN IF NOT EXISTS customer_notice_message TEXT,
  ADD COLUMN IF NOT EXISTS customer_notice_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS restaurant_closure_order_dispositions (
  id BIGSERIAL PRIMARY KEY,
  closure_id BIGINT NOT NULL REFERENCES restaurant_location_closures(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  disposition VARCHAR(20) NOT NULL CHECK (disposition IN ('hand_off', 'finish', 'transfer', 'cancel')),
  note TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (closure_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_closure_dispositions_closure ON restaurant_closure_order_dispositions(closure_id);
CREATE INDEX IF NOT EXISTS idx_closure_dispositions_order ON restaurant_closure_order_dispositions(order_id);
