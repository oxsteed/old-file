-- Migration 308: OxSteed Restaurants — Delivery / Runner backend.
-- Additive only. Adds restaurant-scoped runner tasks plus proof / issue /
-- payment-note logs on top of the food_* ordering and restaurant_* ops layers.

CREATE TABLE IF NOT EXISTS restaurant_runner_tasks (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  order_reference VARCHAR(80) NOT NULL,
  stop_name VARCHAR(200) NOT NULL,
  task_type VARCHAR(40) NOT NULL DEFAULT 'Delivery'
    CHECK (task_type IN ('Delivery', 'Customer pickup', 'Catering', 'Logistics', 'Supplier return')),
  status VARCHAR(24) NOT NULL DEFAULT 'Assigned'
    CHECK (status IN ('Queued', 'Assigned', 'Ready', 'Picked up', 'En route', 'Completed', 'Issue', 'Cancelled')),
  route_window VARCHAR(80),
  customer_contact_rule TEXT,
  requires_proof BOOLEAN NOT NULL DEFAULT FALSE,
  cash_collection_required BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  picked_up_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_tasks_restaurant
  ON restaurant_runner_tasks(restaurant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_runner_tasks_assigned
  ON restaurant_runner_tasks(assigned_to, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_runner_contact_rules (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  detail TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_contact_rules_restaurant
  ON restaurant_runner_contact_rules(restaurant_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS restaurant_runner_proofs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_runner_tasks(id) ON DELETE CASCADE,
  method VARCHAR(40) NOT NULL DEFAULT 'Photo / signature',
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_proofs_task
  ON restaurant_runner_proofs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_runner_issue_reports (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_runner_tasks(id) ON DELETE CASCADE,
  severity VARCHAR(40) NOT NULL DEFAULT 'Needs follow-up',
  note TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_issue_reports_task
  ON restaurant_runner_issue_reports(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_runner_payment_notes (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_runner_tasks(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_payment_notes_task
  ON restaurant_runner_payment_notes(task_id, created_at DESC);
