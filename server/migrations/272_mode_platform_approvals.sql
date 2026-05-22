-- Migration 272: Platform-approval gate for mode actions
--
-- Mode switch itself is always instant. But individual actions inside a mode
-- (e.g., a consultant accepting a paying client) can be gated behind a
-- platform approval. The two tables here track per-user approval state and
-- per-mode policy.
--
-- Default seed: only `consultant` mode requires platform approval, and only
-- for the `accept_paying_booking` action. Auto-approve is OFF (admin must
-- review). Super-admin can flip these on any other mode later.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- mode_platform_approval_policies
-- One row per mode. The set of policies the platform enforces.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mode_platform_approval_policies (
  mode                  VARCHAR(40) PRIMARY KEY,
  requires_approval     BOOLEAN     NOT NULL DEFAULT FALSE,
  auto_approve          BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Action codes that the gate guards. App code looks these up via
  -- requirePlatformApproval(mode, action).
  gated_actions         TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Form schema rendered by the client when the user is prompted to submit
  -- an approval request. JSONB so super-admin can edit without code changes.
  -- Shape: { fields: [{ name, type, label, required, hint?, options?[] }] }
  application_schema    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION touch_mode_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mode_policies_touch ON mode_platform_approval_policies;
CREATE TRIGGER trg_mode_policies_touch
  BEFORE UPDATE ON mode_platform_approval_policies
  FOR EACH ROW EXECUTE FUNCTION touch_mode_policies_updated_at();

-- Seed: one policy row per known mode. Consultant is the only one gated
-- out of the box. Customer / life_only / franchise_applicant explicitly
-- documented as "never gated" so super-admin can still see the row and
-- understand the system surface.
INSERT INTO mode_platform_approval_policies (mode, requires_approval, auto_approve, gated_actions, application_schema)
VALUES
  ('customer',            FALSE, TRUE,  ARRAY[]::TEXT[], '{}'::jsonb),
  ('helper',              FALSE, TRUE,  ARRAY[]::TEXT[], '{}'::jsonb),
  ('business_owner',      FALSE, TRUE,  ARRAY[]::TEXT[], '{}'::jsonb),
  ('tool_owner',          FALSE, TRUE,  ARRAY[]::TEXT[], '{}'::jsonb),
  ('franchise_applicant', FALSE, TRUE,  ARRAY[]::TEXT[], '{}'::jsonb),
  ('life_only',           FALSE, TRUE,  ARRAY[]::TEXT[], '{}'::jsonb),
  ('consultant',          TRUE,  FALSE, ARRAY['accept_paying_booking'], $${
    "fields": [
      { "name": "bio",               "type": "textarea", "label": "Tell us about your consulting practice", "required": true, "minLength": 80, "maxLength": 2000 },
      { "name": "years_experience",  "type": "number",   "label": "Years of relevant experience",          "required": true, "min": 0, "max": 60 },
      { "name": "areas_of_expertise","type": "textarea", "label": "Areas of expertise",                     "required": true, "hint": "One per line (e.g. retail operations, payroll, hiring)" },
      { "name": "sample_work_url",   "type": "url",      "label": "Sample work / LinkedIn / portfolio URL",  "required": false },
      { "name": "certifications",    "type": "textarea", "label": "Certifications, licenses, or credentials","required": false }
    ]
  }$$::jsonb)
ON CONFLICT (mode) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- mode_platform_approvals
-- One row per (user_id, mode) tracking that user's approval state in that
-- mode. A user with no row is effectively `not_requested`.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mode_platform_approvals (
  id                BIGSERIAL    PRIMARY KEY,
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode              VARCHAR(40)  NOT NULL,
  status            VARCHAR(20)  NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','approved','rejected','revoked')),
  -- Submitted application payload (mirrors policy.application_schema fields).
  application_data  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  requested_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewer_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  approval_notes    TEXT,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- A user can only have one active approval row per mode. Re-applies after
  -- a rejection bump the same row.
  UNIQUE (user_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_mode_approvals_status
  ON mode_platform_approvals (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_mode_approvals_mode_status
  ON mode_platform_approvals (mode, status);

DROP TRIGGER IF EXISTS trg_mode_approvals_touch ON mode_platform_approvals;
CREATE TRIGGER trg_mode_approvals_touch
  BEFORE UPDATE ON mode_platform_approvals
  FOR EACH ROW EXECUTE FUNCTION touch_mode_policies_updated_at();

COMMIT;
