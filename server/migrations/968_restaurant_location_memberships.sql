-- Migration 968: store-scoped restaurant memberships (F-02).
--
-- Business membership remains the source of the user's restaurant role. This
-- table narrows an active member to explicit stores when assignments exist;
-- members without assignments retain the pre-migration all-store behavior so
-- existing businesses do not lose access during the staged rollout.

CREATE TABLE IF NOT EXISTS restaurant_location_memberships (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  membership_id BIGINT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  role_override VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT restaurant_location_memberships_role_check
    CHECK (role_override IS NULL OR role_override IN ('manager', 'representative', 'employee', 'support_agent')),
  CONSTRAINT restaurant_location_memberships_location_fk
    FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_location_memberships_active
  ON restaurant_location_memberships (restaurant_id, location_id, membership_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_restaurant_location_memberships_member
  ON restaurant_location_memberships (restaurant_id, membership_id, status);

CREATE INDEX IF NOT EXISTS idx_restaurant_location_memberships_location
  ON restaurant_location_memberships (restaurant_id, location_id, status);

-- A composite foreign key protects the store tenant. This trigger protects
-- the other tenant boundary: the membership must belong to the restaurant's
-- business. Revoked memberships may remain as historical assignments, but
-- they are never returned by the access service.
CREATE OR REPLACE FUNCTION validate_restaurant_location_membership_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM food_restaurants fr
      JOIN business_members bm ON bm.business_id = fr.business_id
     WHERE fr.id = NEW.restaurant_id
       AND bm.id = NEW.membership_id
       AND bm.member_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'restaurant location membership crosses a business tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_location_membership_tenant
  ON restaurant_location_memberships;
CREATE TRIGGER restaurant_location_membership_tenant
  BEFORE INSERT OR UPDATE OF restaurant_id, membership_id
  ON restaurant_location_memberships
  FOR EACH ROW
  EXECUTE FUNCTION validate_restaurant_location_membership_tenant();

