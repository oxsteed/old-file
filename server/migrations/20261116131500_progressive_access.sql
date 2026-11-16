-- Progressive account access (docs/progressive-access/SPEC.md) — data expand.
--
-- Additive only. Legacy users.role, users.default_mode and
-- mode_platform_approvals are untouched and stay readable during the
-- compatibility window. Organization ownership / membership remain canonical
-- in businesses / business_members / restaurant tables; access_grants only
-- holds platform entitlements that have no canonical owner elsewhere.

BEGIN;

-- Signup intent: what the person said they want to do, kept separate from
-- any access. One row per account (latest intent wins until consumed).
CREATE TABLE IF NOT EXISTS access_signup_intents (
  id             BIGSERIAL    PRIMARY KEY,
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent         VARCHAR(40)  NOT NULL
                 CHECK (intent IN ('find_help','offer_services','run_business','run_restaurant')),
  capability     VARCHAR(80),
  return_to      VARCHAR(500),
  source         VARCHAR(40)  NOT NULL DEFAULT 'signup',
  request_id     BIGINT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  consumed_at    TIMESTAMPTZ,
  CONSTRAINT access_signup_intents_user_unique UNIQUE (user_id)
);

-- Pending registrations carry the intent until OTP finalization.
ALTER TABLE IF EXISTS pending_registrations
  ADD COLUMN IF NOT EXISTS signup_intent VARCHAR(40);
ALTER TABLE IF EXISTS pending_registrations
  ADD COLUMN IF NOT EXISTS signup_return_to VARCHAR(500);

CREATE TABLE IF NOT EXISTS access_requests (
  id                 BIGSERIAL    PRIMARY KEY,
  applicant_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability         VARCHAR(80)  NOT NULL,
  subject_type       VARCHAR(30)  NOT NULL DEFAULT 'self'
                     CHECK (subject_type IN ('self','business','business_proposal','restaurant_location')),
  subject_id         VARCHAR(64),
  subject_key        VARCHAR(120) NOT NULL,
  status             VARCHAR(30)  NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','submitted','in_review','needs_information','approved','declined','withdrawn')),
  policy_version     VARCHAR(60)  NOT NULL,
  answers            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  evidence_revision  INTEGER      NOT NULL DEFAULT 1 CHECK (evidence_revision >= 1),
  version            INTEGER      NOT NULL DEFAULT 1 CHECK (version >= 1),
  public_reason_code VARCHAR(60),
  information_request VARCHAR(1000),
  source             VARCHAR(30)  NOT NULL DEFAULT 'in_context'
                     CHECK (source IN ('signup','in_context','settings','legacy_backfill','admin')),
  return_to          VARCHAR(500),
  assigned_reviewer_id UUID       REFERENCES users(id) ON DELETE SET NULL,
  submitted_at       TIMESTAMPTZ,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT access_requests_subject_shape CHECK (
    (subject_type = 'self' AND subject_id IS NULL AND subject_key = 'self')
    OR (subject_type <> 'self' AND subject_id IS NOT NULL AND subject_key = subject_type || ':' || subject_id)
  )
);

-- One open application per applicant, capability and exact subject.
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_open_idx
  ON access_requests (applicant_id, capability, subject_key)
  WHERE status IN ('draft','submitted','in_review','needs_information');
CREATE INDEX IF NOT EXISTS access_requests_applicant_idx
  ON access_requests (applicant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS access_requests_queue_idx
  ON access_requests (status, capability, submitted_at, id)
  WHERE status IN ('submitted','in_review','needs_information');

-- Immutable transition log (applicant, reviewer and system actions).
CREATE TABLE IF NOT EXISTS access_request_decisions (
  id                  BIGSERIAL    PRIMARY KEY,
  request_id          BIGINT       NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
  action              VARCHAR(40)  NOT NULL,
  from_status         VARCHAR(30),
  to_status           VARCHAR(30)  NOT NULL,
  request_version     INTEGER      NOT NULL,
  actor_id            UUID         REFERENCES users(id) ON DELETE SET NULL,
  actor_type          VARCHAR(20)  NOT NULL CHECK (actor_type IN ('applicant','reviewer','system')),
  reviewer_authority  VARCHAR(60),
  evidence_revision   INTEGER,
  policy_version      VARCHAR(60),
  public_reason_code  VARCHAR(60),
  internal_note       VARCHAR(2000),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT access_request_decisions_version_unique UNIQUE (request_id, request_version)
);

CREATE OR REPLACE FUNCTION access_request_decisions_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'access_request_decisions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_access_request_decisions_immutable ON access_request_decisions;
CREATE TRIGGER trg_access_request_decisions_immutable
  BEFORE UPDATE OR DELETE ON access_request_decisions
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION access_request_decisions_immutable();

CREATE TABLE IF NOT EXISTS access_grants (
  id                  BIGSERIAL    PRIMARY KEY,
  user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability          VARCHAR(80)  NOT NULL,
  subject_type        VARCHAR(30)  NOT NULL DEFAULT 'self'
                      CHECK (subject_type IN ('self','business','business_proposal','restaurant_location')),
  subject_id          VARCHAR(64),
  subject_key         VARCHAR(120) NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','suspended','revoked','expired')),
  provenance          VARCHAR(40)  NOT NULL
                      CHECK (provenance IN ('request','legacy_backfill','admin')),
  provenance_reason   VARCHAR(60),
  source_request_id   BIGINT       REFERENCES access_requests(id) ON DELETE SET NULL,
  source_decision_id  BIGINT       REFERENCES access_request_decisions(id) ON DELETE SET NULL,
  policy_version      VARCHAR(60),
  granted_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  granted_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  status_changed_at   TIMESTAMPTZ,
  status_changed_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  status_reason_code  VARCHAR(60),
  version             INTEGER      NOT NULL DEFAULT 1,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT access_grants_entitlement_unique UNIQUE (user_id, capability, subject_key),
  CONSTRAINT access_grants_subject_shape CHECK (
    (subject_type = 'self' AND subject_id IS NULL AND subject_key = 'self')
    OR (subject_type <> 'self' AND subject_id IS NOT NULL AND subject_key = subject_type || ':' || subject_id)
  )
);
CREATE INDEX IF NOT EXISTS access_grants_active_idx
  ON access_grants (user_id) WHERE status = 'active';

-- Per-user projection version: bumped on every grant/request change so
-- clients can detect stale access snapshots.
CREATE TABLE IF NOT EXISTS access_projection_versions (
  user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version     BIGINT      NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Committed notification / invalidation events, delivered after commit.
CREATE TABLE IF NOT EXISTS access_outbox (
  id               BIGSERIAL    PRIMARY KEY,
  event_type       VARCHAR(60)  NOT NULL,
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id       BIGINT       REFERENCES access_requests(id) ON DELETE SET NULL,
  grant_id         BIGINT       REFERENCES access_grants(id) ON DELETE SET NULL,
  payload          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key       VARCHAR(200) NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','failed')),
  attempts         INTEGER      NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_error       VARCHAR(500),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ,
  CONSTRAINT access_outbox_dedupe_unique UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS access_outbox_pending_idx
  ON access_outbox (next_attempt_at, id) WHERE status = 'pending';

-- Idempotency for applicant and reviewer mutations (Idempotency-Key header).
CREATE TABLE IF NOT EXISTS access_idempotency_keys (
  actor_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem_key      VARCHAR(128) NOT NULL,
  action        VARCHAR(60)  NOT NULL,
  fingerprint   CHAR(64)     NOT NULL,
  status_code   INTEGER      NOT NULL,
  response      JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_id, idem_key)
);

-- Legacy backfill bookkeeping (counts only; no personal data in counts).
CREATE TABLE IF NOT EXISTS access_backfill_runs (
  id             BIGSERIAL    PRIMARY KEY,
  mode           VARCHAR(10)  NOT NULL CHECK (mode IN ('dry_run','apply')),
  status         VARCHAR(20)  NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','completed','failed')),
  checkpoint_user_id UUID,
  counts         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  started_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  last_error     VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS access_backfill_exceptions (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       VARCHAR(60)  NOT NULL,
  run_id       BIGINT       REFERENCES access_backfill_runs(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT access_backfill_exceptions_unique UNIQUE (user_id, reason)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'access_signup_intents_request_fk'
       AND conrelid = 'access_signup_intents'::regclass
  ) THEN
    ALTER TABLE access_signup_intents
      ADD CONSTRAINT access_signup_intents_request_fk
      FOREIGN KEY (request_id) REFERENCES access_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
