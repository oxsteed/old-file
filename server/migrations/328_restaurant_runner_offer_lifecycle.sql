-- Migration 328: Claimable runner offers and atomic delivery assignment.

ALTER TABLE restaurant_runner_tasks
  ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(24)
    CHECK (assignment_source IN ('manager','self_claim','automatic','system')),
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_tasks_open_offers
  ON restaurant_runner_tasks (restaurant_id, offer_expires_at, created_at DESC)
  WHERE assigned_to IS NULL AND status IN ('Queued','Ready');

CREATE TABLE IF NOT EXISTS restaurant_runner_task_declines (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_runner_tasks(id) ON DELETE CASCADE,
  runner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, runner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_task_declines_runner
  ON restaurant_runner_task_declines (restaurant_id, runner_user_id, created_at DESC);
