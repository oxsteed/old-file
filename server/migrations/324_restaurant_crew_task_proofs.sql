-- Migration 324: Restaurant crew task proof history.
-- Adds first-class proof records so Crew can submit multiple photos/documents
-- for assigned work while managers retain approval/rejection audit history.

CREATE TABLE IF NOT EXISTS restaurant_crew_task_proofs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_crew_tasks(id) ON DELETE CASCADE,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  proof_type VARCHAR(32) NOT NULL DEFAULT 'photo'
    CHECK (proof_type IN ('photo','document','signature','note','other')),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_task_proofs_task
  ON restaurant_crew_task_proofs(task_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_task_proofs_restaurant
  ON restaurant_crew_task_proofs(restaurant_id, created_at DESC);
