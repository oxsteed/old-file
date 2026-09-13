-- Migration 435: scope food-order idempotency keys to the customer.
-- Guest orders retain restaurant-scoped uniqueness because they have no stable
-- authenticated identity to use as an idempotency scope.

DROP INDEX IF EXISTS idx_food_orders_client_order_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_orders_customer_client_order_id
  ON food_orders (restaurant_id, customer_id, ((metadata->>'clientOrderId')))
  WHERE customer_id IS NOT NULL
    AND metadata->>'clientOrderId' IS NOT NULL
    AND metadata->>'clientOrderId' <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_orders_guest_client_order_id
  ON food_orders (restaurant_id, ((metadata->>'clientOrderId')))
  WHERE customer_id IS NULL
    AND metadata->>'clientOrderId' IS NOT NULL
    AND metadata->>'clientOrderId' <> '';
