-- 533_chat_quotes.sql
-- Profile-messenger quote shares: conversation/guest linkage, revise versions,
-- and job-less helper quotes for live profile threads.

-- ── business_quotes: chat linkage + revise ───────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_quotes') THEN
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS conversation_id UUID;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS guest_session_id UUID;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS parent_quote_id BIGINT;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS booking_request_id UUID;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS appointment_id UUID;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS decline_reason TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bq_conversation_id ON business_quotes(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bq_guest_session_id ON business_quotes(guest_session_id) WHERE guest_session_id IS NOT NULL;

-- ── helper_quotes: allow job-less profile quotes + chat linkage ──────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'helper_quotes') THEN
    -- Drop NOT NULL on job_id if present (profile chat quotes have no job)
    BEGIN
      ALTER TABLE helper_quotes ALTER COLUMN job_id DROP NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;

    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS conversation_id UUID;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS guest_session_id UUID;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS client_user_id UUID;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS client_name VARCHAR(200);
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS title VARCHAR(300);
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS token VARCHAR(64);
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS parent_quote_id UUID;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS booking_request_id UUID;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS appointment_id UUID;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS decline_reason TEXT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_helper_quotes_token
  ON helper_quotes(token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hq_conversation_id ON helper_quotes(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hq_guest_session_id ON helper_quotes(guest_session_id) WHERE guest_session_id IS NOT NULL;

-- ── Share audit (message ↔ quote) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_quote_shares (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_kind        TEXT         NOT NULL CHECK (quote_kind IN ('business', 'helper')),
  quote_id          TEXT         NOT NULL,
  conversation_id   UUID,
  guest_session_id  UUID,
  message_id        TEXT,
  shared_by         UUID,
  status_at_share   TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cqs_conversation ON chat_quote_shares(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cqs_guest ON chat_quote_shares(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cqs_quote ON chat_quote_shares(quote_kind, quote_id);
