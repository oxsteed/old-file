-- Migration 677: featured placement lifecycle.
--
-- Part A: food_restaurants gains featured_until so featured placement can be
-- time-boxed. A restaurant is "effectively featured" when
--   (fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW()))
-- Expiry is evaluated statelessly in queries; no sweeper job is needed.
-- A NULL featured_until means an open-ended (non-expiring) feature.
--
-- Part B: business_featured_placement_requests gains the admin decision audit
-- trail (who decided, when, and the note) plus the restaurant the decision
-- acted on, so approvals, declines, and revocations are all traceable.

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

ALTER TABLE business_featured_placement_requests
  ADD COLUMN IF NOT EXISTS decided_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note TEXT,
  ADD COLUMN IF NOT EXISTS featured_restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_food_restaurants_featured_until
  ON food_restaurants(is_featured, featured_until);

CREATE INDEX IF NOT EXISTS idx_bfpr_featured_restaurant
  ON business_featured_placement_requests(featured_restaurant_id);
