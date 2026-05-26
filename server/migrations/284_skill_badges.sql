-- Migration 284: Skill badges for Learn Mode
-- Awarded when a user completes every guide in a category.
-- One badge per (user, category) — idempotent INSERT ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS skill_badges (
  id          SERIAL       PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    VARCHAR(50)  NOT NULL,
  awarded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_skill_badges_user
  ON skill_badges (user_id);

CREATE INDEX IF NOT EXISTS idx_skill_badges_category
  ON skill_badges (category);
