-- Group 4 rest, item 181: reschedule proposal for hired jobs that have no
-- appointment (jobs with an appointment keep the existing
-- appointment_reschedule_requests flow). Proposal-only, like D-25: the job's
-- time changes only when the other party accepts. Additive and idempotent.
CREATE TABLE IF NOT EXISTS job_reschedule_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  proposed_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_time  TIMESTAMPTZ NOT NULL,
  previous_time  TIMESTAMPTZ,
  reason         TEXT CHECK (reason IS NULL OR char_length(reason) <= 1000),
  status         TEXT NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed', 'accepted', 'declined', 'withdrawn', 'superseded')),
  decided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_reschedule_proposals_job
  ON job_reschedule_proposals (job_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_reschedule_proposals_open_per_side
  ON job_reschedule_proposals (job_id, proposed_by) WHERE status = 'proposed';
