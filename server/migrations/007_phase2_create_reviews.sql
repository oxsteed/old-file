-- Phase 2: Migration 006 - Create reviews table
-- OxSteed v2

BEGIN;

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  reviewer_id INTEGER REFERENCES users(id),
  reviewed_id INTEGER REFERENCES users(id),
  job_id INTEGER NULL,
  introduction_id INTEGER REFERENCES introduction_requests(id) NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NULL,
  job_completed BOOLEAN NULL,
  flagged BOOLEAN DEFAULT FALSE,
  flagged_reason TEXT NULL,
  removed BOOLEAN DEFAULT FALSE,
  removed_reason TEXT NULL,
  removed_by INTEGER REFERENCES users(id) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_id ON reviews(reviewed_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON reviews(reviewer_id);

COMMIT;
