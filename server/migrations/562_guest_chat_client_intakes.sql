-- Optional client intake forms shared by a helper/business in a guest chat.

BEGIN;

CREATE TABLE IF NOT EXISTS guest_profile_chat_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  description VARCHAR(1000),
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  responses JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_chat_intakes_session
  ON guest_profile_chat_intakes(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_chat_intakes_provider
  ON guest_profile_chat_intakes(helper_id, business_id, status, created_at DESC);

COMMIT;
