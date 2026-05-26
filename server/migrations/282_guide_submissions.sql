-- Migration 280: User-generated guide submissions for Learn Mode
-- Helpers and Consultants can submit guides for admin review.
-- Approved guides are published to the Learn page; each keeps full attribution.

CREATE TABLE IF NOT EXISTS guide_submissions (
  id               SERIAL PRIMARY KEY,
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            VARCHAR(200) NOT NULL,
  category         VARCHAR(50)  NOT NULL,
  difficulty       VARCHAR(20)  NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  estimated_minutes INTEGER     NOT NULL CHECK (estimated_minutes > 0 AND estimated_minutes <= 1440),
  intro            TEXT         NOT NULL,
  steps            JSONB        NOT NULL,   -- JSON array of step strings
  skills           JSONB        NOT NULL,   -- JSON array of skill strings
  tools            JSONB,                   -- JSON array of { name, buy_url, rent_url }
  video_url        VARCHAR(500),
  license_note     TEXT,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  reviewer_id      UUID         REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  reviewer_note    TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gs_user_id     ON guide_submissions (user_id);
CREATE INDEX IF NOT EXISTS idx_gs_status      ON guide_submissions (status);
CREATE INDEX IF NOT EXISTS idx_gs_submitted   ON guide_submissions (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_gs_category    ON guide_submissions (category);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION gs_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS gs_updated_at ON guide_submissions;
CREATE TRIGGER gs_updated_at
  BEFORE UPDATE ON guide_submissions
  FOR EACH ROW EXECUTE FUNCTION gs_touch_updated_at();
