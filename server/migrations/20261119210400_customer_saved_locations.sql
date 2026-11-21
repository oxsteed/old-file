-- Group 1 (Customer, item 43): saved service locations.
--
-- A customer saves named service locations (home, office, a relative's
-- house) and reuses them when booking instead of retyping the address.
-- The location is the customer's own record: only the owner can read,
-- use, edit, or delete it, and it is never shared with another customer.
-- Entry instructions travel with the location so the provider sees them
-- on the booking the customer creates from it.
CREATE TABLE IF NOT EXISTS customer_saved_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  entry_instructions TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_saved_locations_user
  ON customer_saved_locations (user_id, created_at DESC);
