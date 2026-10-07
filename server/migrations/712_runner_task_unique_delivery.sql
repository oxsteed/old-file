-- Ensure one Delivery task per order (prevents duplicates from race conditions).
-- The application already uses advisory locks, this is a backstop.

CREATE UNIQUE INDEX IF NOT EXISTS uq_runner_tasks_delivery_per_order
  ON restaurant_runner_tasks (restaurant_id, food_order_id)
  WHERE task_type = 'Delivery' AND food_order_id IS NOT NULL;
