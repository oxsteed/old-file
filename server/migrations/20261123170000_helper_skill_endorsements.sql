-- Group 4 rest, item 194: skill endorsement record.
-- Emile confirmed 2026-11-23: endorsements come only from completed
-- engagements, one per client per skill. The endorsing job is recorded as
-- evidence; the unique key enforces one per client per helper skill.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS helper_skill_endorsements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_skill_id INTEGER NOT NULL REFERENCES helper_skills(id) ON DELETE CASCADE,
  endorser_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT helper_skill_endorsements_not_self CHECK (helper_id <> endorser_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_helper_skill_endorsements_client_skill
  ON helper_skill_endorsements (endorser_id, helper_skill_id);
CREATE INDEX IF NOT EXISTS idx_helper_skill_endorsements_helper
  ON helper_skill_endorsements (helper_id, helper_skill_id);
