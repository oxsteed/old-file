-- OxSteed Careers, Phase 1: employer background checks (Checkr FCRA flow)
-- and voluntary US EEO self-identification (careers spec §6.12, §6.15, §12.4).
--
-- career_background_checks stores status and timestamps only, never the
-- report. It is never joined into search, invitations or ranking (R11).
--
-- EEO answers live in their own schema, encrypted by the application
-- (AES-256-GCM, utils/careersCrypto.js). Only the fairness job and the
-- auditor export read them, aggregated over groups of at least 10 (Q7).
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_background_checks (
  id                     BIGSERIAL PRIMARY KEY,
  application_id         BIGINT NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  offer_id               BIGINT NOT NULL REFERENCES career_offers(id) ON DELETE CASCADE,
  business_id            INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id                UUID REFERENCES users(id) ON DELETE SET NULL,
  provider               TEXT NOT NULL DEFAULT 'checkr' CHECK (provider IN ('checkr')),
  provider_candidate_id  TEXT,
  provider_invitation_id TEXT,
  provider_report_id     TEXT,
  invitation_url         TEXT,
  package                TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'invited' CHECK (status IN (
                           'invited','consented','pending','clear','consider','pre_adverse_sent',
                           'disputed','adverse_sent','cancelled')),
  consent_at             TIMESTAMPTZ,
  pre_adverse_at         TIMESTAMPTZ,
  adverse_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  requested_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_background_checks_offer
  ON career_background_checks (offer_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_career_background_checks_user ON career_background_checks (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_background_checks_report
  ON career_background_checks (provider, provider_report_id) WHERE provider_report_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS career_background_check_events (
  id                   BIGSERIAL PRIMARY KEY,
  background_check_id  BIGINT NOT NULL REFERENCES career_background_checks(id) ON DELETE CASCADE,
  provider_event_id    TEXT,
  event_type           TEXT NOT NULL,
  status               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_bgc_events_provider
  ON career_background_check_events (provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS careers_private;

CREATE TABLE IF NOT EXISTS careers_private.career_eeo_responses (
  id              BIGSERIAL PRIMARY KEY,
  application_id  BIGINT NOT NULL UNIQUE REFERENCES public.career_applications(id) ON DELETE CASCADE,
  ciphertext      TEXT NOT NULL,
  key_version     TEXT NOT NULL DEFAULT 'v1',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE careers_private.career_eeo_responses IS
  'Voluntary US EEO self-ID (Q7). Encrypted by the app. Never joined into employer-facing queries or model inputs.';

COMMIT;
