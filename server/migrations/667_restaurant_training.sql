-- Migration 667: OxSteed Restaurants — Staff training (franchise system).
-- Additive only. Training modules (lessons + quizzes), staff assignments,
-- and completion records per restaurant. Nothing existing is modified.
--
-- FK note: food_restaurants.id is BIGINT (BIGSERIAL); users.id is UUID.

-- Training modules: a lesson (content) plus an optional quiz.
CREATE TABLE IF NOT EXISTS restaurant_training_modules (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  content TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'customer_service', 'safety')),
  pass_score_pct INTEGER NOT NULL DEFAULT 80 CHECK (pass_score_pct BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_training_modules_restaurant
  ON restaurant_training_modules(restaurant_id, is_active, sort_order);

-- Quiz questions inside a module. `options` is a JSON array of strings;
-- `correct_index` points at the right one.
CREATE TABLE IF NOT EXISTS restaurant_training_questions (
  id BIGSERIAL PRIMARY KEY,
  module_id BIGINT NOT NULL REFERENCES restaurant_training_modules(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_index INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_training_questions_module
  ON restaurant_training_questions(module_id, sort_order);

-- One assignment of a module to a staff member. Unique per (module, user) so
-- re-assigning refreshes the existing row instead of duplicating it.
CREATE TABLE IF NOT EXISTS restaurant_training_assignments (
  id BIGSERIAL PRIMARY KEY,
  module_id BIGINT NOT NULL REFERENCES restaurant_training_modules(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed', 'overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (module_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_training_assignments_restaurant
  ON restaurant_training_assignments(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_training_assignments_user
  ON restaurant_training_assignments(user_id, status);

-- Completion record: one per assignment. `answers` snapshots the chosen
-- option indexes so the score stays explainable if questions change later.
CREATE TABLE IF NOT EXISTS restaurant_training_completions (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL UNIQUE REFERENCES restaurant_training_assignments(id) ON DELETE CASCADE,
  score_pct INTEGER NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  passed BOOLEAN NOT NULL,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
