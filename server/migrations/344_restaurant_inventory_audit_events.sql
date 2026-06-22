-- Restaurant Inventory audit events.
--
-- The Inventory app needs an activity stream that is scoped to one restaurant,
-- not a generic business log. This records successful stock, supplier,
-- receiving, transfer, and configuration actions without changing app UI.

CREATE TABLE IF NOT EXISTS restaurant_inventory_audit_events (
  id                  BIGSERIAL PRIMARY KEY,
  restaurant_id       BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  business_id         BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  event_type          VARCHAR(80) NOT NULL,
  entity_type         VARCHAR(60) NOT NULL,
  entity_id           BIGINT,
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  client_operation_id UUID,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_audit_restaurant_created
  ON restaurant_inventory_audit_events (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_audit_entity
  ON restaurant_inventory_audit_events (restaurant_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_audit_actor
  ON restaurant_inventory_audit_events (restaurant_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_audit_operation
  ON restaurant_inventory_audit_events (restaurant_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

COMMENT ON TABLE restaurant_inventory_audit_events IS
  'Restaurant-scoped Inventory app activity stream for stock, receiving, transfers, suppliers, and setup changes.';
