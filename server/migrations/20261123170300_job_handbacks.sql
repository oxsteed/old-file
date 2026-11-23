-- Group 4 rest, item 184: replacement handoff. The assigned helper hands a
-- hired job back before it starts; the job reopens for a replacement. One
-- row per hand-back is the record (the helper's own work record stays with
-- the helper). No money moves: the service refuses when any payment, Credit
-- hold, collateral or confirmed off-platform payment exists on the job.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS job_handbacks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  helper_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bid_id            UUID,
  appointment_id    BIGINT,
  reason_code       TEXT NOT NULL
                    CHECK (reason_code IN ('schedule_conflict', 'illness', 'outside_skills', 'travel', 'other')),
  note              TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  reopened_bid_count INTEGER NOT NULL DEFAULT 0 CHECK (reopened_bid_count >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_handbacks_job ON job_handbacks (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_handbacks_helper ON job_handbacks (helper_id, created_at DESC);
