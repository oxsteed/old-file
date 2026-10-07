-- Migration 722: analyst reviews of One Truth suspect pairs.
--
-- One Truth P1 (item 12.4): the suspect queue needs a persistent reviewed
-- status so analysts can triage pairs and filter by review state. Pair keys
-- are deterministic (the two user ids sorted lexicographically, joined with
-- ':'), matching the pairKey the API returns on each suspect pair.

CREATE TABLE IF NOT EXISTS one_truth_pair_reviews (
  pair_key    TEXT        PRIMARY KEY,
  user_a_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('reviewed', 'confirmed', 'dismissed')),
  reviewed_by UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  notes       TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_truth_pair_reviews_ordered CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_one_truth_pair_reviews_status
  ON one_truth_pair_reviews (status);
CREATE INDEX IF NOT EXISTS idx_one_truth_pair_reviews_users
  ON one_truth_pair_reviews (user_a_id, user_b_id);
