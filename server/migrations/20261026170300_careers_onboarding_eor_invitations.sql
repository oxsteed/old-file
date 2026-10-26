-- OxSteed Careers, Phases 2-3: onboarding runs, employer-of-record
-- assignments and invitations to apply (careers spec §6.8, §6.9, §6.15).
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_onboarding_runs (
  id              BIGSERIAL PRIMARY KEY,
  application_id  BIGINT NOT NULL UNIQUE REFERENCES career_applications(id) ON DELETE CASCADE,
  offer_id        BIGINT NOT NULL REFERENCES career_offers(id) ON DELETE CASCADE,
  business_id     INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  member_id       BIGINT REFERENCES business_members(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  acting_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','needs_action','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_career_onboarding_runs_business ON career_onboarding_runs (business_id, status);

CREATE TABLE IF NOT EXISTS career_onboarding_steps (
  run_id      BIGINT NOT NULL REFERENCES career_onboarding_runs(id) ON DELETE CASCADE,
  step        TEXT NOT NULL CHECK (step IN ('membership','location','pin','training','documents','age_confirmed',
                                            'eor_enrollment','first_shift','payroll_handoff','notify')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped','failed','needs_action')),
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, step)
);

CREATE TABLE IF NOT EXISTS career_eor_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  member_id           BIGINT REFERENCES business_members(id) ON DELETE SET NULL,
  business_id         INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  application_id      BIGINT REFERENCES career_applications(id) ON DELETE SET NULL,
  partner             TEXT NOT NULL,
  partner_worker_ref  TEXT,
  state_or_country    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'enrolling' CHECK (status IN ('enrolling','ready','active','ended','failed')),
  workers_comp_class  TEXT,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_eor_assignment_application
  ON career_eor_assignments (application_id) WHERE application_id IS NOT NULL AND status <> 'ended';

-- Markets where EOR may be offered (licence held by OxSteed or the partner).
-- Empty by default: EOR is unavailable until legal review fills it (§12.7 ⚖).
CREATE TABLE IF NOT EXISTS career_eor_markets (
  country      CHAR(2) NOT NULL,
  region       TEXT NOT NULL DEFAULT '',
  licence_ref  TEXT NOT NULL,
  approved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  PRIMARY KEY (country, region)
);

CREATE TABLE IF NOT EXISTS career_invitations (
  id           BIGSERIAL PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  opening_id   BIGINT REFERENCES career_openings(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  source       TEXT NOT NULL CHECK (source IN ('talent_you_know','talent_search')),
  reason_code  TEXT NOT NULL CHECK (reason_code IN ('worked_with_us','great_reviews','certified','skills_match','nearby')),
  message      TEXT CHECK (message IS NULL OR char_length(message) <= 500),
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','viewed','applied','declined','expired')),
  permissible_purpose_certified BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Q19 caps: 50 a day per business; 3 per rolling month per business+worker.
CREATE INDEX IF NOT EXISTS idx_career_invitations_business_day ON career_invitations (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_invitations_pair ON career_invitations (business_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_invitations_user ON career_invitations (user_id, status, created_at DESC);

-- Per-business serialization for the caps (taken FOR UPDATE inside the insert).
CREATE TABLE IF NOT EXISTS career_invitation_locks (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE
);

-- Talent search abuse controls (§4.10 step 5).
CREATE TABLE IF NOT EXISTS career_talent_search_locks (
  business_id  INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  locked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  released_at  TIMESTAMPTZ
);

COMMIT;
