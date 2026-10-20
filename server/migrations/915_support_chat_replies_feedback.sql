-- Migration 915: AI support chat reply log + feedback (quality metrics).
--
-- One row per assistant reply in the AI support chat. It stores only what
-- the quality metrics need: the page (ids stripped), locale, provider/model,
-- guide revision, whether a handoff was suggested/followed, a SHORT reply
-- preview (160 chars max, never the user's message) and the optional
-- thumbs feedback with a reason from a fixed list. Feedback can be removed
-- again (un-toggle) by setting it back to NULL. Rows follow the user on
-- account deletion (CASCADE); guest rows have no user.

CREATE TABLE IF NOT EXISTS support_chat_replies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  page              VARCHAR(200),
  locale            VARCHAR(10) NOT NULL DEFAULT 'en',
  provider          VARCHAR(20),
  model             VARCHAR(120),
  guide_revision    VARCHAR(40),
  cached            BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_suggested BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_reason    VARCHAR(60),
  handoff_followed  BOOLEAN NOT NULL DEFAULT FALSE,
  reply_preview     VARCHAR(160),
  feedback          SMALLINT
    CONSTRAINT support_chat_replies_feedback_check CHECK (feedback IN (-1, 1)),
  feedback_reason   VARCHAR(40),
  feedback_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_chat_replies_created
  ON support_chat_replies (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_chat_replies_user
  ON support_chat_replies (user_id, created_at DESC) WHERE user_id IS NOT NULL;
