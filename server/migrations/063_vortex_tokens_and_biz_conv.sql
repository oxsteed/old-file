-- Migration 063: Vortex invite tokens + business context on conversations
-- ============================================================

-- ── 1. Single-use Vortex tokens (helper → representative onboarding) ──────────
-- The helper generates one of these per representative slot. It is a
-- 64-character hex string that can only be redeemed once and expires on
-- the date the helper chose.

CREATE TABLE IF NOT EXISTS business_invite_tokens (
  id           BIGSERIAL    PRIMARY KEY,
  business_id  INT          NOT NULL REFERENCES businesses(id)  ON DELETE CASCADE,
  owner_id     UUID         NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  -- 64-char hex produced by crypto.randomBytes(32).toString('hex')
  token        CHAR(64)     NOT NULL,
  role         VARCHAR(30)  NOT NULL DEFAULT 'representative'
                 CHECK (role IN ('manager', 'representative')),
  -- Owner decides the expiry window
  expires_at   TIMESTAMPTZ  NOT NULL,
  -- Filled in when the token is redeemed
  used_at      TIMESTAMPTZ,
  used_by_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
  -- Owner can revoke before use
  is_revoked   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Token string itself is globally unique
  UNIQUE (token)
);

-- Fast single-use lookup (only index unused, non-revoked tokens)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bit_token_active
  ON business_invite_tokens (token)
  WHERE used_at IS NULL AND is_revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_bit_business
  ON business_invite_tokens (business_id);

-- ── 2. Business context on conversations ─────────────────────────────────────
-- When a conversation is initiated through a business profile page,
-- business_id is set. This lets business representatives (business_members)
-- access and reply to the thread alongside the owner.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS business_id INT REFERENCES businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_business_id
  ON conversations (business_id)
  WHERE business_id IS NOT NULL;
