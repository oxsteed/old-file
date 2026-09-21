-- 534_chat_pop_agreements_admin.sql
-- In-chat proof of payment + agreements + admin break-glass access log.
-- Security model: Telegram cloud-chat analogue (server-stored, membership ACL,
-- audited admin access) — NOT secret-chat E2EE.

-- ── Proof of payment ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_proof_of_payments (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID,
  guest_session_id    UUID,
  business_id         UUID,
  helper_id           UUID,
  quote_kind          TEXT         CHECK (quote_kind IS NULL OR quote_kind IN ('business', 'helper')),
  quote_id            TEXT,
  booking_request_id  UUID,
  appointment_id      UUID,
  amount_cents        INTEGER      NOT NULL DEFAULT 0 CHECK (amount_cents >= 0 AND amount_cents <= 1000000000),
  currency            CHAR(3)      NOT NULL DEFAULT 'USD',
  payment_method      VARCHAR(80),
  transaction_id      VARCHAR(200),
  paid_on             DATE,
  status              TEXT         NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted', 'confirmed', 'rejected')),
  notes               TEXT,
  attachment_key      TEXT,
  attachment_name     VARCHAR(300),
  attachment_mime     VARCHAR(120),
  attachment_size     INTEGER      CHECK (attachment_size IS NULL OR (attachment_size >= 0 AND attachment_size <= 20971520)),
  message_id          TEXT,
  submitted_by        UUID,
  submitted_by_guest  BOOLEAN      NOT NULL DEFAULT FALSE,
  confirmed_by        UUID,
  confirmed_at        TIMESTAMPTZ,
  reject_reason       TEXT,
  sensitive           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpop_conversation ON chat_proof_of_payments(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpop_guest ON chat_proof_of_payments(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpop_quote ON chat_proof_of_payments(quote_kind, quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpop_status ON chat_proof_of_payments(status);

-- ── Agreements ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_agreements (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id          UUID,
  guest_session_id         UUID,
  business_id              UUID,
  helper_id                UUID,
  title                    VARCHAR(300) NOT NULL,
  body_text                TEXT,
  version                  INTEGER      NOT NULL DEFAULT 1 CHECK (version >= 1),
  parent_agreement_id      UUID,
  token                    VARCHAR(64),
  status                   TEXT         NOT NULL DEFAULT 'shared'
                           CHECK (status IN ('draft', 'shared', 'acknowledged', 'accepted', 'declined', 'superseded')),
  required_before_schedule BOOLEAN      NOT NULL DEFAULT FALSE,
  attachment_key           TEXT,
  attachment_name          VARCHAR(300),
  attachment_mime          VARCHAR(120),
  attachment_size          INTEGER      CHECK (attachment_size IS NULL OR (attachment_size >= 0 AND attachment_size <= 20971520)),
  message_id               TEXT,
  shared_by                UUID,
  superseded_at            TIMESTAMPTZ,
  decline_reason           TEXT,
  sensitive                BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_agreements_token
  ON chat_agreements(token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cagr_conversation ON chat_agreements(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cagr_guest ON chat_agreements(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cagr_parent ON chat_agreements(parent_agreement_id) WHERE parent_agreement_id IS NOT NULL;

-- Append-only acceptance / response evidence
CREATE TABLE IF NOT EXISTS chat_agreement_responses (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id      UUID         NOT NULL REFERENCES chat_agreements(id) ON DELETE CASCADE,
  action            TEXT         NOT NULL CHECK (action IN ('acknowledge', 'accept', 'decline')),
  actor_user_id     UUID,
  actor_guest_session_id UUID,
  actor_name        VARCHAR(200),
  actor_email       VARCHAR(255),
  ip_hash           VARCHAR(64),
  user_agent        TEXT,
  note              TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cagr_resp_agreement ON chat_agreement_responses(agreement_id);
CREATE INDEX IF NOT EXISTS idx_cagr_resp_created ON chat_agreement_responses(created_at DESC);

-- ── Admin break-glass access log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_conversation_access_log (
  id                BIGSERIAL    PRIMARY KEY,
  admin_id          UUID         NOT NULL,
  conversation_id   UUID,
  guest_session_id  UUID,
  reason            TEXT         NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_conv_access_target_chk CHECK (
    conversation_id IS NOT NULL OR guest_session_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_conv_access_admin ON admin_conversation_access_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_conv_access_conv ON admin_conversation_access_log(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_conv_access_guest ON admin_conversation_access_log(guest_session_id) WHERE guest_session_id IS NOT NULL;
