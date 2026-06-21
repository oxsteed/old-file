CREATE TABLE IF NOT EXISTS restaurant_crew_shifts (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  label VARCHAR(160) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','open','closed','cancelled')),
  notes TEXT,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_shifts_restaurant
  ON restaurant_crew_shifts(restaurant_id, starts_at DESC, status);

ALTER TABLE restaurant_crew_tasks
  ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES restaurant_crew_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_tasks_shift
  ON restaurant_crew_tasks(restaurant_id, shift_id, status, due_at NULLS LAST);
