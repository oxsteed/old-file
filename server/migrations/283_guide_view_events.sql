-- Migration 283: Guide view events for Learn Mode trending / social proof
-- Records every time a user expands a guide detail panel.
-- Front-end deduplicates within a session (ref set), so this is roughly
-- "unique guide opens per page visit" rather than raw click counts.
-- Used by GET /api/learn/stats to power the "X completed / X views" badges.

CREATE TABLE IF NOT EXISTS guide_view_events (
  id         SERIAL       PRIMARY KEY,
  guide_id   VARCHAR(100) NOT NULL,
  user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  viewed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gve_guide_id ON guide_view_events (guide_id);
CREATE INDEX IF NOT EXISTS idx_gve_viewed   ON guide_view_events (viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gve_user     ON guide_view_events (user_id)
  WHERE user_id IS NOT NULL;
