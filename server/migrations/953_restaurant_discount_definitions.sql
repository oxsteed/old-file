-- 953_restaurant_discount_definitions.sql
-- Franchise review F-15 + staff-management review S-07 (discount approval).
--
-- F-15: POS discounts stop being three hard-coded global codes
-- (WELCOME10 / LUNCH15 / VIP20, which stay as the legacy fallback). Each
-- restaurant can now define its own discounts with a percent or fixed
-- value, an optional maximum discount, an optional minimum subtotal and
-- an optional manager-approval requirement. Definitions are merchant
-- managed (restaurant.manage) and every write is audited through
-- business_audit_log by the controller.
--
-- S-07: discounts join the manager-PIN approval policy. A definition can
-- require approval outright (requires_approval), and a restaurant can set
-- settings.posApprovalPolicy.discountAboveCents so any definition
-- discount above that amount needs a manager PIN, consumed through
-- restaurant_pos_approvals like voids/refunds/comps. That requires
-- 'discount' to be a legal approvals action, so the 948 CHECK widens.

CREATE TABLE IF NOT EXISTS restaurant_discount_definitions (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- percent: integer percent 1..100. fixed: amount in cents >= 1.
  value INTEGER NOT NULL CHECK (value >= 1),
  max_discount_cents INTEGER CHECK (max_discount_cents IS NULL OR max_discount_cents >= 0),
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_discount_definitions_restaurant
  ON restaurant_discount_definitions (restaurant_id, is_active);

-- S-07: 'discount' becomes a first-class manager-approval action.
ALTER TABLE restaurant_pos_approvals
  DROP CONSTRAINT IF EXISTS restaurant_pos_approvals_action_check;
ALTER TABLE restaurant_pos_approvals
  ADD CONSTRAINT restaurant_pos_approvals_action_check
  CHECK (action IN ('payout', 'cash_out', 'no_sale', 'void', 'refund', 'comp', 'discount'));
