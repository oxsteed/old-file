-- Migration 306: OxSteed Restaurants — Operations MVP (Phase 2).
-- Additive only. Adds checklists/SOPs to the restaurant operating system on top
-- of the existing food_* ordering foundation (migration 305). Nothing in 305 is
-- modified. New tables use the restaurant_* prefix (the external brand is
-- "OxSteed Restaurants"; food_* remains the internal legacy implementation).
--
-- FK note: food_restaurants.id is BIGINT (BIGSERIAL); users.id is UUID.

-- Checklist templates a restaurant defines (opening/closing/cleaning/food-safety/custom).
CREATE TABLE IF NOT EXISTS restaurant_checklists (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  checklist_type VARCHAR(24) NOT NULL DEFAULT 'opening'
    CHECK (checklist_type IN ('opening', 'closing', 'cleaning', 'food_safety', 'custom')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_checklists_restaurant
  ON restaurant_checklists(restaurant_id, is_active, sort_order);

-- Tasks inside a checklist template.
CREATE TABLE IF NOT EXISTS restaurant_checklist_tasks (
  id BIGSERIAL PRIMARY KEY,
  checklist_id BIGINT NOT NULL REFERENCES restaurant_checklists(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  instructions TEXT,
  requires_note BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_checklist_tasks_checklist
  ON restaurant_checklist_tasks(checklist_id, is_active, sort_order);

-- A single execution of a checklist (e.g. "today's opening checklist").
CREATE TABLE IF NOT EXISTS restaurant_checklist_runs (
  id BIGSERIAL PRIMARY KEY,
  checklist_id BIGINT NOT NULL REFERENCES restaurant_checklists(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  business_day DATE NOT NULL DEFAULT CURRENT_DATE,
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_restaurant_checklist_runs_restaurant
  ON restaurant_checklist_runs(restaurant_id, business_day DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_checklist_runs_checklist
  ON restaurant_checklist_runs(checklist_id, status);

-- Per-task completion state inside a run. `label` is snapshotted from the task
-- at run-start so historical runs stay accurate even if the template changes.
CREATE TABLE IF NOT EXISTS restaurant_checklist_run_items (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES restaurant_checklist_runs(id) ON DELETE CASCADE,
  task_id BIGINT REFERENCES restaurant_checklist_tasks(id) ON DELETE SET NULL,
  label VARCHAR(255) NOT NULL,
  requires_note BOOLEAN NOT NULL DEFAULT FALSE,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_restaurant_checklist_run_items_run
  ON restaurant_checklist_run_items(run_id, sort_order);

-- Standard Operating Procedures library.
CREATE TABLE IF NOT EXISTS restaurant_sops (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'opening', 'closing', 'safety')),
  body TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_sops_restaurant
  ON restaurant_sops(restaurant_id, is_published, category);
