-- Migration 310: OxSteed Restaurants — Crew training + certifications.
-- Adds restaurant-scoped training assignments, quiz result summaries, and
-- badge/certification state so the dedicated Crew app can stop relying on
-- local-only sample data for its core tabs.

CREATE TABLE IF NOT EXISTS restaurant_crew_training_modules (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  role VARCHAR(80) NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  is_complete BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_training_modules_restaurant
  ON restaurant_crew_training_modules(restaurant_id, role, sort_order, id);

CREATE TABLE IF NOT EXISTS restaurant_crew_quiz_results (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  score_percent INTEGER NOT NULL DEFAULT 0 CHECK (score_percent >= 0 AND score_percent <= 100),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_quiz_results_restaurant
  ON restaurant_crew_quiz_results(restaurant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_crew_badges (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  detail TEXT NOT NULL,
  awarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_badges_restaurant
  ON restaurant_crew_badges(restaurant_id, awarded, id);
